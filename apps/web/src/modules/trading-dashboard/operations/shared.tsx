import { ApiError } from "@/lib/api";
import type { IntegrationSyncResult, ProviderConnectionStatus } from "@/types/trading";

export function apiMessage(error: unknown) {
  if (error instanceof ApiError) {
    const details = error.details as
      | {
          detail?:
            | string
            | {
                blockers?: string[];
                warnings?: string[];
                message?: string;
                errors?: Array<{ row?: number | null; field?: string; message?: string }>;
              };
        }
      | string
      | null;

    if (typeof details === "string") {
      return details;
    }

    if (typeof details?.detail === "string") {
      return details.detail;
    }

    if (details?.detail && typeof details.detail === "object") {
      const blockers = details.detail.blockers ?? [];
      const warnings = details.detail.warnings ?? [];
      const validationErrors = details.detail.errors ?? [];
      const validationMessage = validationErrors
        .slice(0, 4)
        .map((item) => `${item.row ? `Row ${item.row}, ` : ""}${item.field ? `${item.field}: ` : ""}${item.message ?? "Invalid value."}`)
        .join(" ");
      return [details.detail.message, ...blockers, ...warnings, validationMessage].filter(Boolean).join(" ");
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Request failed.";
}


export function syncResultMessage(result: IntegrationSyncResult, prefix: string) {
  const details = result.results
    .map(
      (item) =>
        `${item.provider}: ${item.status}${item.records_count ? ` (${item.records_count})` : ""}${
          item.message ? ` — ${item.message}` : ""
        }`,
    )
    .join(" · ");
  return details ? `${prefix}. ${details}.` : `${prefix}.`;
}


export function formatOperationTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}


export function marketFeedLabel(feed: string | null, isConsolidated = false, delaySeconds: number | null = null) {
  if (feed === "iex") {
    return "Real-time IEX · single venue";
  }
  if (feed === "delayed_sip") {
    return "15-min delayed SIP · consolidated";
  }
  if (feed === "sip") {
    return "Real-time SIP · paid access required";
  }
  if (delaySeconds && delaySeconds > 0) {
    return `${Math.round(delaySeconds / 60)}-min delayed${isConsolidated ? " · consolidated" : ""}`;
  }
  return isConsolidated ? "Consolidated market feed" : feed?.replaceAll("_", " ") || "Feed not selected";
}

export function connectionLabel(connection: ProviderConnectionStatus) {
  if (connection.purpose === "market_data") {
    if (connection.source_feed === "sip" && !connection.enabled) {
      return "Real-time SIP requested · access unverified";
    }
    return marketFeedLabel(connection.source_feed, connection.is_consolidated, connection.real_time ? 0 : 900);
  }
  if (connection.purpose === "paper_broker") {
    return connection.environment === "paper" ? "Alpaca paper account" : "Paper account unavailable";
  }
  if (connection.provider === "sec_edgar") {
    return "Public SEC EDGAR feed";
  }
  return connection.real_time ? "Real-time entitlement" : "Free REST feed · freshness varies";
}


export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

export function PreviewStat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${emphasize ? "bg-blue-50 ring-1 ring-blue-100" : "bg-slate-50"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 ${emphasize ? "font-semibold text-blue-900" : "text-sm font-medium text-ink"}`}>{value}</div>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
