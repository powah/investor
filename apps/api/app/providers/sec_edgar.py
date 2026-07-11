"""SEC EDGAR adapter for the public ticker map and recent submissions API."""

import asyncio
import re
from typing import Any, Dict, Mapping, Optional, Tuple, Union
from urllib.parse import quote

import httpx

from app.providers._normalization import (
    parse_date,
    parse_datetime,
    string_tuple,
    utc_now,
)
from app.providers.contracts import (
    CompanyTicker,
    FilingProviderCapabilities,
    FilingSubmission,
    FilingSubmissions,
    ProviderPayloadError,
    Provenance,
    TickerMap,
)


SEC_DATA_BASE_URL = "https://data.sec.gov"
SEC_WEB_BASE_URL = "https://www.sec.gov"
SEC_FAIR_ACCESS_REQUESTS_PER_SECOND = 10
_SEC_RATE_LIMITER_LOOP_ATTRIBUTE = "_investor_sec_edgar_rate_limiter"
_CONTACT_EMAIL_PATTERN = re.compile(
    r"(?<![A-Z0-9._%+-])"
    r"[A-Z0-9._%+-]+@"
    r"(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+"
    r"[A-Z]{2,63}"
    r"(?![A-Z0-9._%+-])",
    re.IGNORECASE,
)


class _SecRequestRateLimiter:
    """Evenly reserve SEC request slots without allowing an initial burst."""

    def __init__(self, requests_per_second: int) -> None:
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be positive.")
        self._interval_seconds = 1 / requests_per_second
        self._lock = asyncio.Lock()
        self._next_request_at = 0.0

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            delay = self._next_request_at - now
            if delay > 0:
                await asyncio.sleep(delay)
                now = loop.time()
            self._next_request_at = max(self._next_request_at, now) + self._interval_seconds


def _shared_sec_rate_limiter() -> _SecRequestRateLimiter:
    # Providers created in the same application loop share one reservation
    # stream across both sec.gov hosts. Storing it on the loop also avoids
    # reusing an asyncio.Lock across the fresh loops created by unit tests.
    loop = asyncio.get_running_loop()
    limiter = getattr(loop, _SEC_RATE_LIMITER_LOOP_ATTRIBUTE, None)
    if limiter is None:
        limiter = _SecRequestRateLimiter(SEC_FAIR_ACCESS_REQUESTS_PER_SECOND)
        setattr(loop, _SEC_RATE_LIMITER_LOOP_ATTRIBUTE, limiter)
    return limiter


def validate_sec_user_agent(user_agent: str) -> str:
    if not isinstance(user_agent, str) or "\r" in user_agent or "\n" in user_agent:
        raise ValueError(
            "SEC user_agent must identify the caller and include a contact email address."
        )
    declared_user_agent = user_agent.strip()
    email_match = _CONTACT_EMAIL_PATTERN.search(declared_user_agent)
    identity = (
        declared_user_agent[: email_match.start()] + declared_user_agent[email_match.end() :]
        if email_match
        else ""
    )
    if (
        not declared_user_agent
        or len(declared_user_agent) > 256
        or email_match is None
        or len(re.findall(r"[A-Z0-9]", identity, re.IGNORECASE)) < 2
    ):
        raise ValueError(
            "SEC user_agent must identify the caller and include a contact email address."
        )
    return declared_user_agent


class SecEdgarProvider:
    """Read public SEC data while always declaring the caller's User-Agent."""

    def __init__(
        self,
        user_agent: str,
        *,
        data_base_url: str = SEC_DATA_BASE_URL,
        web_base_url: str = SEC_WEB_BASE_URL,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._user_agent = validate_sec_user_agent(user_agent)
        self._data_base_url = data_base_url.rstrip("/")
        self._web_base_url = web_base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=20.0, follow_redirects=True)

    @property
    def capabilities(self) -> FilingProviderCapabilities:
        return FilingProviderCapabilities(
            provider="sec_edgar",
            real_time=True,
            typical_delay_seconds=1,
            fair_access_requests_per_second=SEC_FAIR_ACCESS_REQUESTS_PER_SECOND,
        )

    @property
    def _headers(self) -> Dict[str, str]:
        return {
            "User-Agent": self._user_agent,
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
        }

    async def _get(self, url: str) -> httpx.Response:
        await _shared_sec_rate_limiter().wait()
        response = await self._client.get(url, headers=self._headers)
        response.raise_for_status()
        return response

    async def get_ticker_map(self) -> TickerMap:
        response = await self._get(f"{self._web_base_url}/files/company_tickers_exchange.json")
        payload = response.json()
        rows = self._ticker_rows(payload)
        observed_at = utc_now()
        provenance = Provenance(
            provider="sec_edgar",
            observed_at=observed_at,
            source_feed="company_tickers_exchange",
            request_id=_request_id(response),
        )
        entries = []
        for row in rows:
            cik_value = row.get("cik")
            ticker = str(row.get("ticker") or "").strip().upper()
            name = str(row.get("name") or "").strip()
            if cik_value in (None, "") or not ticker or not name:
                continue
            entries.append(
                CompanyTicker(
                    cik=_normalize_cik(cik_value),
                    name=name,
                    ticker=ticker,
                    exchange=_optional_text(row.get("exchange")),
                    provenance=provenance,
                )
            )
        return TickerMap(entries=tuple(entries), provenance=provenance)

    @staticmethod
    def _ticker_rows(payload: Any) -> Tuple[Mapping[str, Any], ...]:
        if not isinstance(payload, dict):
            raise ProviderPayloadError("SEC ticker map response must be an object.")
        fields = payload.get("fields")
        data = payload.get("data")
        if not isinstance(fields, list) or not isinstance(data, list):
            raise ProviderPayloadError("SEC ticker map requires fields and data arrays.")
        field_names = tuple(str(field) for field in fields)
        rows = []
        for raw_row in data:
            if not isinstance(raw_row, list):
                raise ProviderPayloadError("SEC ticker map rows must be arrays.")
            rows.append(dict(zip(field_names, raw_row)))
        return tuple(rows)

    async def get_submissions(self, cik: Union[str, int]) -> FilingSubmissions:
        normalized_cik = _normalize_cik(cik)
        response = await self._get(
            f"{self._data_base_url}/submissions/CIK{normalized_cik}.json"
        )
        payload = response.json()
        if not isinstance(payload, dict):
            raise ProviderPayloadError("SEC submissions response must be an object.")

        company_name = str(payload.get("name") or "").strip()
        if not company_name:
            raise ProviderPayloadError("SEC submissions response is missing the company name.")
        filings_root = payload.get("filings")
        recent = filings_root.get("recent") if isinstance(filings_root, dict) else None
        if not isinstance(recent, dict):
            raise ProviderPayloadError("SEC submissions response is missing filings.recent.")

        observed_at = utc_now()
        provenance = Provenance(
            provider="sec_edgar",
            observed_at=observed_at,
            source_feed="submissions",
            request_id=_request_id(response),
        )
        accessions = recent.get("accessionNumber", [])
        if not isinstance(accessions, list):
            raise ProviderPayloadError("SEC filings.recent.accessionNumber must be an array.")
        filings = tuple(
            self._normalize_filing(
                normalized_cik,
                company_name,
                recent,
                index,
                provenance,
            )
            for index, accession in enumerate(accessions)
            if str(accession or "").strip()
        )
        older_files = _older_history_files(filings_root)
        return FilingSubmissions(
            cik=normalized_cik,
            company_name=company_name,
            tickers=tuple(
                ticker.upper() for ticker in string_tuple(payload.get("tickers"))
            ),
            exchanges=string_tuple(payload.get("exchanges")),
            filings=filings,
            older_history_files=older_files,
            provenance=provenance,
        )

    def _normalize_filing(
        self,
        cik: str,
        company_name: str,
        recent: Mapping[str, Any],
        index: int,
        provenance: Provenance,
    ) -> FilingSubmission:
        accession = str(_column(recent, "accessionNumber", index) or "").strip()
        form = str(_column(recent, "form", index) or "").strip().upper()
        primary_document = _optional_text(_column(recent, "primaryDocument", index))
        archive_path = f"{int(cik)}/{accession.replace('-', '')}"
        index_url = (
            f"{self._web_base_url}/Archives/edgar/data/{archive_path}/"
            f"{quote(accession)}-index.html"
        )
        document_url = None
        if primary_document:
            document_url = (
                f"{self._web_base_url}/Archives/edgar/data/{archive_path}/"
                f"{quote(primary_document, safe='/')}"
            )
        return FilingSubmission(
            cik=cik,
            company_name=company_name,
            accession_number=accession,
            form=form,
            provenance=provenance,
            filing_date=parse_date(_column(recent, "filingDate", index)),
            report_date=parse_date(_column(recent, "reportDate", index)),
            accepted_at=parse_datetime(_column(recent, "acceptanceDateTime", index)),
            primary_document=primary_document,
            primary_document_description=_optional_text(
                _column(recent, "primaryDocDescription", index)
            ),
            items=string_tuple(_column(recent, "items", index), separator=","),
            is_xbrl=_as_bool(_column(recent, "isXBRL", index)),
            is_inline_xbrl=_as_bool(_column(recent, "isInlineXBRL", index)),
            document_url=document_url,
            index_url=index_url,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.aclose()


def _normalize_cik(cik: Union[str, int]) -> str:
    raw = str(cik).strip()
    if raw.upper().startswith("CIK"):
        raw = raw[3:]
    if not raw.isdigit() or int(raw) <= 0 or len(raw) > 10:
        raise ValueError("CIK must be a positive integer with at most 10 digits.")
    return raw.zfill(10)


def _column(recent: Mapping[str, Any], name: str, index: int) -> Any:
    values = recent.get(name)
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def _older_history_files(filings_root: Any) -> Tuple[str, ...]:
    if not isinstance(filings_root, dict):
        return ()
    files = filings_root.get("files")
    if not isinstance(files, list):
        return ()
    normalized = []
    for file_record in files:
        if not isinstance(file_record, dict):
            continue
        name = _optional_text(file_record.get("name"))
        if name:
            normalized.append(name)
    return tuple(normalized)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def _optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _request_id(response: httpx.Response) -> Optional[str]:
    for header in ("x-request-id", "request-id", "x-amzn-requestid"):
        value = response.headers.get(header)
        if value:
            return value
    return None
