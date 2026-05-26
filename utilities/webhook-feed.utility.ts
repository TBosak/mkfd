import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WebhookFeedConfig, WebhookFeedEvent, WebhookFeedPayload } from "../models/webhook.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";

const DEFAULT_EVENT_DIR = join(__dirname, "../feed-state/webhooks");

export function generateWebhookToken(): string {
  return `mkfd_wh_${randomBytes(32).toString("hex")}`;
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyWebhookToken(token: string, tokenHash: string): boolean {
  if (!token || !tokenHash) return false;
  const supplied = Buffer.from(hashWebhookToken(token), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  if (supplied.length !== stored.length) return false;
  return timingSafeEqual(supplied, stored);
}

export function validateWebhookPayload(input: unknown): WebhookFeedPayload {
  if (!input || typeof input !== "object") throw new Error("Webhook payload must be an object");
  const payload = input as Record<string, unknown>;
  if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 300) {
    throw new Error("Webhook payload title is required and must be 300 characters or fewer");
  }
  if (payload.severity && !["info", "success", "warning", "error"].includes(String(payload.severity))) {
    throw new Error("Webhook payload severity is invalid");
  }
  if (payload.categories && !Array.isArray(payload.categories)) throw new Error("Webhook payload categories must be an array");
  return {
    id: stringOpt(payload.id),
    title: payload.title.trim(),
    description: stringOpt(payload.description),
    url: stringOpt(payload.url),
    date: stringOpt(payload.date),
    author: stringOpt(payload.author),
    categories: Array.isArray(payload.categories) ? payload.categories.map(String) : undefined,
    severity: payload.severity as WebhookFeedPayload["severity"],
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata as Record<string, unknown> : undefined,
  };
}

export function normalizeWebhookEvent(feedId: string, payload: WebhookFeedPayload, config: WebhookFeedConfig, receivedAt = new Date()): WebhookFeedEvent {
  const eventDate = config.dateStrategy === "receivedAt" ? receivedAt.toISOString() : payload.date ?? receivedAt.toISOString();
  const dedupeKey = config.duplicateStrategy === "always"
    ? `${receivedAt.getTime()}-${randomBytes(4).toString("hex")}`
    : config.duplicateStrategy === "idOnly" && payload.id
      ? payload.id
      : payload.id ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    id: createHash("sha256").update(`${feedId}:${dedupeKey}`).digest("hex"),
    feedId,
    externalId: payload.id,
    receivedAt: receivedAt.toISOString(),
    eventDate,
    title: payload.title,
    description: payload.description,
    link: payload.url,
    author: payload.author,
    categories: payload.categories ?? [],
    severity: payload.severity,
    metadata: payload.metadata,
    rawPayload: config.storeRawPayload ? payload : undefined,
    dedupeKey,
  };
}

export async function appendWebhookEvent(feedId: string, event: WebhookFeedEvent, dir = DEFAULT_EVENT_DIR): Promise<{ duplicate: boolean }> {
  await mkdir(dir, { recursive: true });
  const events = await readWebhookEvents(feedId, dir);
  if (events.some((existing) => existing.dedupeKey === event.dedupeKey)) return { duplicate: true };
  events.unshift(event);
  await writeFile(join(dir, `${feedId}.jsonl`), events.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  return { duplicate: false };
}

export async function readWebhookEvents(feedId: string, dir = DEFAULT_EVENT_DIR): Promise<WebhookFeedEvent[]> {
  const path = join(dir, `${feedId}.jsonl`);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  return raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

export function buildWebhookItems(events: WebhookFeedEvent[], config: WebhookFeedConfig): NormalizedFeedItem[] {
  return events.slice(0, config.maxItems).map((event) => ({
    title: event.title,
    link: event.link,
    description: event.description,
    guid: event.id,
    pubDate: event.eventDate,
    author: event.author,
    categories: event.categories,
    raw: event,
  }));
}

const stringOpt = (value: unknown) => typeof value === "string" && value ? value : undefined;
