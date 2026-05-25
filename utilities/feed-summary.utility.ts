import type { FeedSummary, FeedStatus, FeedType } from "../frontend/src/types/feed-summary";
import { detectPlainSensitive } from "./config-metadata.utility";

const FEED_TYPE_MAP: Record<string, FeedType> = {
  webScraping: "scrape", api: "rest", rest: "rest", email: "email",
  graphql: "graphql", calendar: "calendar", sitemap: "sitemap",
  filesystem: "filesystem", webhook: "webhook", feedTransformer: "scrape",
};

export function normalizeFeedType(yamlType: string): FeedType {
  return FEED_TYPE_MAP[yamlType] ?? "scrape";
}

export function toRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} h ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function detectSecrets(config: any): { protected: boolean; env: boolean; plain: boolean } {
  let hasProtected = false;
  let hasEnv = false;
  function walk(o: any) {
    if (typeof o !== "object" || o === null) return;
    if (o.type === "protected") { hasProtected = true; return; }
    if (o.type === "env") { hasEnv = true; return; }
    for (const v of Object.values(o)) walk(v);
  }
  walk(config);
  return { protected: hasProtected, env: hasEnv, plain: detectPlainSensitive(config) };
}

function deriveSourceUrl(config: any): { sourceUrl: string; sourceMethod?: string } {
  const c = config.config ?? {};
  const type = config.feedType;
  if (type === "webScraping" || type === "sitemap" || type === "calendar") return { sourceUrl: c.baseUrl ?? c.url ?? "" };
  if (type === "api" || type === "rest") {
    const url = c.baseUrl + (c.route ? c.route : "");
    return { sourceUrl: url, sourceMethod: (c.method ?? "GET").toUpperCase() };
  }
  if (type === "graphql") return { sourceUrl: c.endpoint ?? c.baseUrl ?? "", sourceMethod: "POST" };
  if (type === "email") {
    const host = c.host ?? c.imap?.host ?? "";
    const folder = c.folder ?? "INBOX";
    return { sourceUrl: `${host} / ${folder}` };
  }
  if (type === "filesystem") return { sourceUrl: c.watchPath ?? c.path ?? "/app/watch" };
  if (type === "webhook") return { sourceUrl: c.path ?? `/webhook-feeds/${config.feedId}` };
  return { sourceUrl: c.baseUrl ?? c.url ?? "" };
}

export function buildFeedSummary(file: { id: string; filename: string }, config: any, lastRun?: any): FeedSummary {
  const enabled = config.enabled !== false;
  const meta = config.metadata ?? {};
  let status: FeedStatus;
  let statusDetail: string | undefined;
  if (!enabled) {
    status = "disabled";
  } else if (!lastRun) {
    status = "neverRun";
  } else if (lastRun.status === "error") {
    status = "error";
    statusDetail = lastRun.errorMessage ?? undefined;
  } else {
    const secrets = detectSecrets(config);
    status = secrets.plain ? "warning" : "healthy";
    if (secrets.plain) statusDetail = "Password stored as plain string in config.";
  }
  const lastRunAt = lastRun ? new Date(lastRun.startedAt).toISOString() : undefined;
  const lastRunRelative = lastRunAt ? toRelative(lastRunAt) : undefined;
  const lastItemCount = lastRun?.itemCount ?? null;
  const lastNewItemCount = lastRun?.itemCount != null && lastRun?.prevItemCount != null
    ? Math.max(0, lastRun.itemCount - lastRun.prevItemCount) : 0;
  const { sourceUrl, sourceMethod } = deriveSourceUrl(config);
  return {
    id: file.id, filename: file.filename,
    title: meta.title ?? config.feedName ?? file.id,
    description: meta.description,
    type: normalizeFeedType(config.feedType),
    category: meta.category,
    sourceUrl, sourceMethod,
    publicFeedUrl: `/feeds/${file.id}`,
    enabled, favorite: meta.favorite ?? false, tags: meta.tags ?? [],
    status, statusDetail,
    refreshMinutes: config.refreshTime ?? null,
    lastRunAt, lastRunRelative, lastItemCount, lastNewItemCount,
    secrets: detectSecrets(config),
    origin: { type: meta.origin?.type === "community" ? "community" : "local", catalogId: meta.origin?.catalogId },
  };
}
