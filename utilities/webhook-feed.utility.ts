import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createWebhookEventStore, getDb } from "../lib/analytics/db";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import type {
	WebhookFeedConfig,
	WebhookFeedEvent,
	WebhookFeedPayload,
} from "../models/webhook.model";

const DEFAULT_EVENT_DIR = join(__dirname, "../feed-state/webhooks");
const encoder = new TextEncoder();

const WEBHOOK_LIMITS = {
	idBytes: 300,
	titleBytes: 300,
	descriptionBytes: 20_000,
	urlBytes: 2_048,
	dateBytes: 64,
	authorBytes: 300,
	categories: 25,
	categoryBytes: 100,
	metadataBytes: 16 * 1024,
	metadataDepth: 8,
	metadataNodes: 1_024,
	maxItems: 1_000,
	retentionDays: 3_650,
} as const;

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
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Webhook payload must be an object.");
	}
	const payload = input as Record<string, unknown>;
	if (typeof payload.title !== "string") {
		throw new Error("Webhook payload title must be a string.");
	}
	const title = payload.title.trim();
	if (!title) throw new Error("Webhook payload title is required.");
	assertUtf8Limit(title, "title", WEBHOOK_LIMITS.titleBytes);

	const id = optionalBoundedString(payload, "id", WEBHOOK_LIMITS.idBytes);
	const description = optionalBoundedString(
		payload,
		"description",
		WEBHOOK_LIMITS.descriptionBytes,
	);
	const url = optionalBoundedString(payload, "url", WEBHOOK_LIMITS.urlBytes);
	if (url !== undefined) assertSafeWebhookUrl(url);
	const date = optionalBoundedString(payload, "date", WEBHOOK_LIMITS.dateBytes);
	if (date !== undefined) assertValidWebhookDate(date);
	const author = optionalBoundedString(
		payload,
		"author",
		WEBHOOK_LIMITS.authorBytes,
	);

	let categories: string[] | undefined;
	if (Object.hasOwn(payload, "categories")) {
		if (!Array.isArray(payload.categories)) {
			throw new Error("Webhook payload categories must be an array.");
		}
		if (payload.categories.length > WEBHOOK_LIMITS.categories) {
			throw new Error(
				`Webhook payload categories must contain at most ${WEBHOOK_LIMITS.categories} items.`,
			);
		}
		categories = payload.categories.map((category) => {
			if (typeof category !== "string" || !category.trim()) {
				throw new Error(
					"Webhook payload categories must contain non-empty strings.",
				);
			}
			assertUtf8Limit(category, "categories", WEBHOOK_LIMITS.categoryBytes);
			return category;
		});
	}

	let severity: WebhookFeedPayload["severity"];
	if (Object.hasOwn(payload, "severity")) {
		if (
			typeof payload.severity !== "string" ||
			!["info", "success", "warning", "error"].includes(payload.severity)
		) {
			throw new Error("Webhook payload severity is invalid.");
		}
		severity = payload.severity as WebhookFeedPayload["severity"];
	}

	let metadata: Record<string, unknown> | undefined;
	if (Object.hasOwn(payload, "metadata")) {
		if (
			!payload.metadata ||
			typeof payload.metadata !== "object" ||
			Array.isArray(payload.metadata)
		) {
			throw new Error("Webhook payload metadata must be a JSON object.");
		}
		assertSafeMetadata(payload.metadata as Record<string, unknown>);
		metadata = payload.metadata as Record<string, unknown>;
	}

	return {
		id,
		title,
		description,
		url,
		date,
		author,
		categories,
		severity,
		metadata,
	};
}

export function normalizeWebhookFeedConfig(
	input: WebhookFeedConfig | Record<string, unknown>,
): WebhookFeedConfig {
	const maxItems = normalizePositiveInteger(
		input.maxItems,
		"maxItems",
		WEBHOOK_LIMITS.maxItems,
	);
	const retentionDays = normalizePositiveInteger(
		input.retentionDays,
		"retentionDays",
		WEBHOOK_LIMITS.retentionDays,
	);
	return { ...(input as WebhookFeedConfig), maxItems, retentionDays };
}

export function normalizeWebhookEvent(
	feedId: string,
	payload: WebhookFeedPayload,
	config: WebhookFeedConfig,
	receivedAt = new Date(),
): WebhookFeedEvent {
	let eventDate: string;
	if (config.dateStrategy === "receivedAt") {
		eventDate = receivedAt.toISOString();
	} else if (payload.date) {
		eventDate = payload.date;
	} else if (config.dateStrategy === "payloadDateOnly") {
		throw new Error("Webhook payload date is required by the date strategy.");
	} else {
		eventDate = receivedAt.toISOString();
	}

	const dedupeKey =
		config.duplicateStrategy === "always"
			? `${receivedAt.getTime()}-${randomBytes(4).toString("hex")}`
			: config.duplicateStrategy === "idOnly" && payload.id
				? payload.id
				: (payload.id ??
					createHash("sha256").update(JSON.stringify(payload)).digest("hex"));

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

export async function readWebhookEvents(
	feedId: string,
): Promise<WebhookFeedEvent[]> {
	return createWebhookEventStore(getDb(), {
		legacyDir: DEFAULT_EVENT_DIR,
	}).read(feedId, WEBHOOK_LIMITS.maxItems);
}

export function buildWebhookItems(
	events: WebhookFeedEvent[],
	config: WebhookFeedConfig,
): NormalizedFeedItem[] {
	const maxItems = normalizeWebhookFeedConfig(config).maxItems;
	return events.slice(0, maxItems).map((event) => ({
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

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

function assertUtf8Limit(value: string, field: string, limit: number): void {
	if (utf8Bytes(value) > limit) {
		throw new Error(
			`Webhook payload ${field} must be ${limit.toLocaleString("en-US")} bytes or fewer.`,
		);
	}
}

function optionalBoundedString(
	payload: Record<string, unknown>,
	field: string,
	limit: number,
): string | undefined {
	if (!Object.hasOwn(payload, field)) return undefined;
	const value = payload[field];
	if (typeof value !== "string") {
		throw new Error(`Webhook payload ${field} must be a string.`);
	}
	assertUtf8Limit(value, field, limit);
	return value || undefined;
}

function assertSafeWebhookUrl(value: string): void {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("Webhook payload url must be an absolute HTTP(S) URL.");
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		!parsed.hostname ||
		parsed.username ||
		parsed.password
	) {
		throw new Error("Webhook payload url must be an absolute HTTP(S) URL.");
	}
}

function assertValidWebhookDate(value: string): void {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		throw new Error("Webhook payload date must be a valid date.");
	}
	const isoCalendar = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
	if (isoCalendar) {
		const parsed = new Date(timestamp);
		if (
			parsed.getUTCFullYear() !== Number(isoCalendar[1]) ||
			parsed.getUTCMonth() + 1 !== Number(isoCalendar[2]) ||
			parsed.getUTCDate() !== Number(isoCalendar[3])
		) {
			throw new Error("Webhook payload date must be a valid date.");
		}
	}
}

function assertSafeMetadata(metadata: Record<string, unknown>): void {
	let nodes = 0;
	const active = new WeakSet<object>();
	const visit = (value: unknown, depth: number): void => {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "boolean"
		) {
			return;
		}
		if (typeof value === "number") {
			if (Number.isFinite(value)) return;
			throw new Error("Webhook payload metadata must contain JSON values.");
		}
		if (typeof value !== "object") {
			throw new Error("Webhook payload metadata must contain JSON values.");
		}
		if (depth > WEBHOOK_LIMITS.metadataDepth) {
			throw new Error(
				`Webhook payload metadata depth must not exceed ${WEBHOOK_LIMITS.metadataDepth}.`,
			);
		}
		const object = value as object;
		if (active.has(object)) {
			throw new Error("Webhook payload metadata must not contain cycles.");
		}
		if (!Array.isArray(value)) {
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error("Webhook payload metadata must contain JSON values.");
			}
		}
		active.add(object);
		const entries = Array.isArray(value)
			? value.map((entry, index) => [String(index), entry] as const)
			: Object.entries(value as Record<string, unknown>);
		for (const [key, entry] of entries) {
			nodes += 1;
			if (nodes > WEBHOOK_LIMITS.metadataNodes) {
				throw new Error(
					`Webhook payload metadata must contain at most ${WEBHOOK_LIMITS.metadataNodes.toLocaleString("en-US")} keys and array elements.`,
				);
			}
			if (["__proto__", "prototype", "constructor"].includes(key)) {
				throw new Error("Webhook payload metadata contains an unsafe key.");
			}
			visit(entry, depth + 1);
		}
		active.delete(object);
	};

	visit(metadata, 1);
	let serialized: string;
	try {
		serialized = JSON.stringify(metadata);
	} catch {
		throw new Error("Webhook payload metadata must be serializable JSON.");
	}
	if (utf8Bytes(serialized) > WEBHOOK_LIMITS.metadataBytes) {
		throw new Error(
			`Webhook payload metadata must be ${WEBHOOK_LIMITS.metadataBytes.toLocaleString("en-US")} bytes or fewer.`,
		);
	}
}

function normalizePositiveInteger(
	value: unknown,
	field: string,
	maximum: number,
): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`Webhook ${field} must be a positive integer.`);
	}
	return Math.min(value, maximum);
}
