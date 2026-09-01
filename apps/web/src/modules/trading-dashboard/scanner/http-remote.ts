import { apiFetch } from "@/lib/api";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type { ScannerSession, ScannerSymbol } from "@/types/trading";

export const httpScannerRemote: ScannerRemote = {
  listCandidates: () => apiFetch<ScannerSymbol[]>("/scanner"),
  listSessions: () => apiFetch<ScannerSession[]>("/scanner-sessions"),
  getSession: (sessionId) => apiFetch<ScannerSession>(`/scanner-sessions/${sessionId}`),
  importSampleCandidates: () => apiFetch<ScannerSymbol[]>("/scanner/import-sample", { method: "POST" }),
  startSession: () => apiFetch<ScannerSession>("/scanner-sessions", { method: "POST" }),
  importCandidatesCsv: (file) => {
    const body = new FormData();
    body.append("file", file);
    return apiFetch<ScannerSymbol[]>("/scanner/import-csv", { method: "POST", body });
  },
  updateCandidateStatus: (ticker, status) =>
    apiFetch<ScannerSymbol>(`/scanner/${encodeURIComponent(ticker)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
};
