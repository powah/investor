import { apiFetch } from "@/lib/api";
import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { Analytics } from "@/types/trading";

export const httpAnalyticsRemote: AnalyticsRemote = {
  getSummary: () => apiFetch<Analytics>("/analytics"),
};
