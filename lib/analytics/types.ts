export type RunMetrics = {
  startedAt: number;
  durationMs: number | null;
  httpStatus: number | null;
  timedOut: boolean;
  itemCount: number | null;
  selectorMatches: Record<string, number> | null;
  dateFallbacks: number;
  duplicateGuids: number;
  webhookStatus: "success" | "failed" | "skipped" | null;
  webhookError: string | null;
  errorMessage: string | null;
};
