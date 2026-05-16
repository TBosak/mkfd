export type RunLog = {
  id: number;
  feedId: string;
  feedName: string;
  feedType: "webScraping" | "api" | "email";
  startedAt: number;
  durationMs: number | null;
  status: "success" | "error";
  errorMessage: string | null;
  httpStatus: number | null;
  timedOut: number;
  itemCount: number | null;
  prevItemCount: number | null;
  selectorMatches: string | null;
  dateFallbacks: number;
  duplicateGuids: number;
  webhookStatus: "success" | "failed" | "skipped" | null;
  webhookError: string | null;
};

export type FeedHealth = {
  feedId: string;
  feedName: string;
  feedType: string;
  healthStatus: "green" | "yellow" | "red";
  lastRunAt: number | null;
  lastHttpStatus: number | null;
  successRate7d: number;
  avgDuration7d: number;
};

export type HealthSummary = {
  totalRuns: number;
  last24h: number;
  successRate7d: number;
  avgDuration7d: number;
  feedHealth: FeedHealth[];
};

export type ChartRun = {
  startedAt: number;
  durationMs: number | null;
  itemCount: number | null;
  status: "success" | "error";
};

export type HealthSettings = {
  retentionDays: number;
  retentionDaysEnabled: boolean;
  retentionRuns: number;
  retentionRunsEnabled: boolean;
  dbPath: string;
};
