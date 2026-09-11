// TDD slice: p3-webhook-event-state.
//
// Requirements exercised (see docs/tdd/p3-webhook-event-state.md):
//   1-4  bounded native payload validation, metadata safety, and normalization
//   5    bounded runtime maxItems/retentionDays configuration
//   6    managed SQLite schema, indexes, and migration
//   7-9  transactional ingestion, dedupe, concurrency, retention, ordering,
//        rollback, and restart durability
//   10   copy-forward legacy JSONL migration and safe diagnostics
//   11-14 bearer-header auth, content type, sanitized errors, per-slug rate,
//        and feed-item compatibility
//
// Behavior-level seams introduced for lead review:
//
//   - `normalizeWebhookFeedConfig(config)` is a pure public policy function.
//     It returns a config with maxItems in [1, 1000] and retentionDays in
//     [1, 3650], clamps values above the ceiling, and rejects non-integer,
//     non-finite, or non-positive values. It does not alter unrelated v2
//     settings. The exact function name is intentionally the only naming
//     choice made here; no internal validation design is prescribed.
//
//   - `createWebhookEventStore(sqlite, { clock, legacyDir })` returns a small
//     engine-neutral store with `ingest(feedId, event, { maxItems,
//     retentionDays })`, `read(feedId, limit)`, and `migrateLegacy()` methods.
//     `clock` returns a Date and `legacyDir` identifies a caller-owned
//     temporary JSONL directory. This seam is needed to test a real SQLite
//     file, controlled ingestion time, restart, migration, and transaction
//     rollback without touching data/runtime.db or repository feed-state.
//     Supplying `legacyDir` also makes the initialization/read path perform
//     idempotent copy-forward automatically; the explicit migration method is
//     retained for direct migration behavior assertions.
//     Implementations may expose equivalent wrappers instead; these tests
//     deliberately assert only the observable behavior of those operations.
//
//   - `webhookFeedRouter({ configsDir, clock })` accepts an optional clock
//     returning epoch milliseconds. This is solely for deterministic rolling
//     minute-window tests; the route may use any equivalent clock injection.
//     For the success/output test below, the same router options may also
//     accept the store returned above plus a caller-owned `outputDir`. Those
//     seams keep the route test on the real SQLite/output behavior without
//     writing repository `public/feeds` fixtures.
//     The injected store is also the failure boundary used to verify that
//     persistence errors are sanitized before they reach the client.
//
// The seams above are not production implementation requirements beyond the
// externally observable behavior they make testable. They are called through
// runtime export checks so a missing seam fails as a missing behavior rather
// than as a module-import/harness error.

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as analyticsDb from "../lib/analytics/db";
import * as analyticsSchema from "../lib/analytics/schema";
import type { FeedConfig } from "../models/feed-config.model";
import type {
	WebhookFeedConfig,
	WebhookFeedEvent,
} from "../models/webhook.model";
import { webhookFeedRouter } from "../routes/webhook";
import { writeFeedConfig } from "../utilities/config-manager.utility";
import * as webhook from "../utilities/webhook-feed.utility";
import { hashWebhookToken } from "../utilities/webhook-feed.utility";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REAL_MIGRATIONS_DIR = join(REPO_ROOT, "drizzle", "migrations");
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

let fixtureCounter = 0;
const fixtureDirs: string[] = [];

function uniqueFixtureDir(label: string): string {
	fixtureCounter += 1;
	const dir = join(
		REPO_ROOT,
		".tdd-state",
		"_p3-webhook-event-state",
		`${label}-${process.pid}-${fixtureCounter}`,
	);
	fixtureDirs.push(dir);
	return dir;
}

afterEach(async () => {
	// Every fixture path is narrow and private to this test file. Keeping the
	// cleanup scoped here also makes failures recoverable for inspection until
	// the test process reaches this hook.
	const paths = fixtureDirs.splice(0);
	await Promise.all(
		paths.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** Return a deterministic string with exactly `targetBytes` UTF-8 bytes. */
function utf8StringOfBytes(targetBytes: number, unit = "é"): string {
	if (targetBytes < 0) throw new Error("targetBytes must be non-negative");
	const unitBytes = utf8Bytes(unit);
	const repetitions = Math.floor(targetBytes / unitBytes);
	const remainder = targetBytes - repetitions * unitBytes;
	return unit.repeat(repetitions) + "a".repeat(remainder);
}

function jsonBytes(value: unknown): number {
	return utf8Bytes(JSON.stringify(value));
}

/** Largest deterministic `{ padding }` object at or below a byte ceiling. */
function metadataAtMostBytes(targetBytes: number): Record<string, unknown> {
	let low = 0;
	let high = targetBytes;
	let best = { padding: "" };
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = { padding: "x".repeat(middle) };
		if (jsonBytes(candidate) <= targetBytes) {
			best = candidate;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return best;
}

function metadataOverBytes(targetBytes: number): Record<string, unknown> {
	const candidate = metadataAtMostBytes(targetBytes);
	const padding = String(candidate.padding);
	return { padding: `${padding}x` };
}

function nestedMetadata(depth: number): Record<string, unknown> {
	let current: Record<string, unknown> = { leaf: "ok" };
	// The leaf object is level one; each wrapper adds one object level.
	for (let level = 1; level < depth; level += 1) current = { child: current };
	return current;
}

function metadataWithKeys(count: number): Record<string, unknown> {
	const value: Record<string, unknown> = {};
	for (let index = 0; index < count; index += 1) value[`key-${index}`] = index;
	return value;
}

function expectValidationFailure(
	payload: unknown,
	field: string,
	forbiddenValue?: string,
	limitText?: string | RegExp,
): void {
	let message = "";
	try {
		webhook.validateWebhookPayload(payload);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message, `expected ${field} validation to fail`).not.toBe("");
	expect(message.toLowerCase()).toContain(field.toLowerCase());
	if (forbiddenValue !== undefined)
		expect(message).not.toContain(forbiddenValue);
	if (limitText instanceof RegExp) expect(message).toMatch(limitText);
	else if (limitText !== undefined) expect(message).toContain(limitText);
}

function requireExport<T extends (...args: never[]) => unknown>(
	moduleValue: object,
	name: string,
): T {
	const value = (moduleValue as Record<string, unknown>)[name];
	if (typeof value !== "function") {
		throw new Error(
			`Missing required webhook event-state behavior: export ${name}()`,
		);
	}
	return value as T;
}

function migrationCount(result: Record<string, unknown>): number | undefined {
	for (const [key, value] of Object.entries(result)) {
		if (
			/(?:import|insert|migrat|copy)/i.test(key) &&
			typeof value === "number"
		) {
			return value;
		}
	}
	return undefined;
}

const BASE_WEBHOOK_CONFIG: WebhookFeedConfig = {
	slug: "events",
	tokenHash: hashWebhookToken("mkfd_wh_test-token"),
	maxItems: 100,
	retentionDays: 30,
	duplicateStrategy: "idOrHash",
	dateStrategy: "payloadDateOrReceivedAt",
	storeRawPayload: false,
	mapping: { mode: "native" },
};

function configWith(
	overrides: Partial<WebhookFeedConfig> = {},
): WebhookFeedConfig {
	return { ...BASE_WEBHOOK_CONFIG, ...overrides };
}

function makeEvent(
	feedId: string,
	externalId: string,
	receivedAt: Date,
	config: WebhookFeedConfig = configWith(),
): WebhookFeedEvent {
	const payload = webhook.validateWebhookPayload({
		id: externalId,
		title: `Event ${externalId}`,
		description: `Description ${externalId}`,
		url: `https://example.test/events/${externalId}`,
		date: receivedAt.toISOString(),
		author: "p3-test",
		categories: ["test", "webhook"],
		severity: "info",
		metadata: { externalId },
	});
	return webhook.normalizeWebhookEvent(feedId, payload, config, receivedAt);
}

type WebhookEventStore = {
	ingest: (
		feedId: string,
		event: WebhookFeedEvent,
		policy: { maxItems: number; retentionDays: number },
	) => Promise<{ duplicate: boolean }>;
	read: (feedId: string, limit?: number) => Promise<WebhookFeedEvent[]>;
	migrateLegacy: () => Promise<Record<string, unknown>>;
};

function openMigratedSqlite(label: string): {
	sqlite: Database;
	dbPath: string;
} {
	const dir = uniqueFixtureDir(label);
	// bun:sqlite does not create missing parent directories for a file path.
	// The directory is a test-owned fixture, never the repository runtime DB.
	mkdirSync(dir, { recursive: true });
	const dbPath = join(dir, "runtime.db");
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema: analyticsSchema });
	migrate(db, { migrationsFolder: REAL_MIGRATIONS_DIR });
	return { sqlite, dbPath };
}

function createStore(
	sqlite: Database,
	options: { clock?: () => Date; legacyDir?: string } = {},
): WebhookEventStore {
	const factory = requireExport<
		(db: Database, opts?: typeof options) => WebhookEventStore
	>(analyticsDb, "createWebhookEventStore");
	return factory(sqlite, options);
}

function tableRows(sqlite: Database): Array<{ name: string }> {
	return sqlite
		.query(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhook_feed_events'",
		)
		.all() as Array<{ name: string }>;
}

function tableColumns(sqlite: Database): string[] {
	return (
		sqlite.query("PRAGMA table_info(webhook_feed_events)").all() as Array<{
			name: string;
		}>
	).map((column) => column.name);
}

function tableInfo(
	sqlite: Database,
): Array<{ name: string; notnull: number; pk: number }> {
	return sqlite.query("PRAGMA table_info(webhook_feed_events)").all() as Array<{
		name: string;
		notnull: number;
		pk: number;
	}>;
}

function seedWebhookEvents(sqlite: Database, events: WebhookFeedEvent[]): void {
	const insert = sqlite.query(`
    INSERT INTO webhook_feed_events (
      id, feed_id, external_id, received_at, event_date, title, description,
      link, author, categories_json, severity, metadata_json,
      raw_payload_json, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
	const seed = sqlite.transaction(() => {
		for (const event of events) {
			insert.run(
				event.id,
				event.feedId,
				event.externalId ?? null,
				event.receivedAt,
				event.eventDate,
				event.title,
				event.description ?? null,
				event.link ?? null,
				event.author ?? null,
				JSON.stringify(event.categories),
				event.severity ?? null,
				event.metadata === undefined ? null : JSON.stringify(event.metadata),
				event.rawPayload === undefined
					? null
					: JSON.stringify(event.rawPayload),
				event.dedupeKey,
			);
		}
	});
	seed();
}

function indexColumns(sqlite: Database, indexName: string): string[] {
	return (
		sqlite
			.query(`PRAGMA index_info(${JSON.stringify(indexName)})`)
			.all() as Array<{ name: string }>
	).map((column) => column.name);
}

function webhookRouterFor(
	configsDir: string,
	clock: () => number,
	extra: Record<string, unknown> = {},
): { fetch: (request: Request) => Promise<Response> } {
	const factory = webhookFeedRouter as unknown as (
		deps: Record<string, unknown>,
	) => {
		fetch: (request: Request) => Promise<Response>;
	};
	return factory({ configsDir, clock, ...extra });
}

async function writeRouteFixture(label: string): Promise<{
	configsDir: string;
	slug: string;
	token: string;
	feedId: string;
}> {
	const dir = uniqueFixtureDir(label);
	const configsDir = join(dir, "configs");
	await mkdir(configsDir, { recursive: true });
	const feedId = `${label}-feed-${fixtureCounter}`;
	const slug = `${label}-slug-${fixtureCounter}`;
	const token = `mkfd_wh_${label}-token-${fixtureCounter}`;
	await writeFeedConfig(
		feedId,
		{
			feedId,
			feedName: `Webhook ${label}`,
			feedType: "webhook",
			refreshTime: 0,
			webhookFeed: configWith({ slug, tokenHash: hashWebhookToken(token) }),
		} as unknown as FeedConfig,
		configsDir,
	);
	return { configsDir, slug, token, feedId };
}

async function routeRequest(
	router: { fetch: (request: Request) => Promise<Response> },
	slug: string,
	init: RequestInit = {},
	query = "",
): Promise<Response> {
	return router.fetch(
		new Request(`http://test.local/webhook-feeds/${slug}${query}`, {
			method: "POST",
			...init,
		}),
	);
}

describe("webhook native payload validation", () => {
	test("accepts every native field at its documented boundary without coercion", () => {
		const id = utf8StringOfBytes(300);
		const title = utf8StringOfBytes(300);
		const description = utf8StringOfBytes(20_000);
		const url = `https://example.test/${"a".repeat(
			2_048 - "https://example.test/".length,
		)}`;
		const author = utf8StringOfBytes(300);
		const categories = Array.from({ length: 25 }, (_, index) =>
			utf8StringOfBytes(100, index % 2 === 0 ? "é" : "a"),
		);
		const dateAtLimit = `Thu, 10 Sep 2026 12:34:56 GMT ${"(foo)".repeat(6)}(xx)`;
		const metadata = metadataAtMostBytes(16 * 1024);
		const result = webhook.validateWebhookPayload({
			id,
			title: `  ${title}  `,
			description,
			url,
			date: dateAtLimit,
			author,
			categories,
			severity: "warning",
			metadata,
			unknownV2Field: { preservedByCaller: true },
		});

		expect(result.id).toBe(id);
		expect(result.title).toBe(title);
		expect(result.description).toBe(description);
		expect(result.url).toBe(url);
		expect(result.date).toBe(dateAtLimit);
		expect(result.author).toBe(author);
		expect(result.categories).toEqual(categories);
		expect(result.severity).toBe("warning");
		expect(result.metadata).toEqual(metadata);
		expect(result).not.toHaveProperty("unknownV2Field");
	});

	test("rejects one UTF-8 byte over each scalar limit and does not reflect submitted values", () => {
		const marker = "p3-webhook-secret-marker";
		expectValidationFailure(
			{ title: "ok", id: utf8StringOfBytes(301) },
			"id",
			undefined,
			"300",
		);
		expectValidationFailure(
			{ title: utf8StringOfBytes(301) },
			"title",
			undefined,
			"300",
		);
		expectValidationFailure(
			{ title: "ok", description: utf8StringOfBytes(20_001) },
			"description",
			undefined,
			/20(?:,?000)/,
		);
		expectValidationFailure(
			{ title: "ok", url: `https://example.test/${"a".repeat(2_048)}` },
			"url",
			undefined,
			/2(?:,?048)/,
		);
		expectValidationFailure(
			{ title: "ok", author: utf8StringOfBytes(301) },
			"author",
			undefined,
			"300",
		);
		// Error text must not reveal attacker-controlled values in addition to
		// enforcing the exact one-byte boundary above.
		expectValidationFailure(
			{ title: `${marker}${utf8StringOfBytes(301)}` },
			"title",
			marker,
		);
		expectValidationFailure(
			{ title: "ok", categories: [utf8StringOfBytes(101)] },
			"categories",
			undefined,
			"100",
		);
		expectValidationFailure(
			{ title: "ok", metadata: metadataOverBytes(16 * 1024) },
			"metadata",
			undefined,
			/16(?:,?384)/,
		);
	});

	test("rejects empty/whitespace title and wrong recognized property types without coercion", () => {
		expectValidationFailure({ title: "" }, "title");
		expectValidationFailure({ title: " \t\n" }, "title");

		const wrongTypes: Array<[string, unknown]> = [
			["id", 42],
			["description", 42],
			["url", 42],
			["date", 42],
			["author", 42],
			["categories", { value: "not-an-array" }],
			["severity", 42],
			["metadata", null],
			["metadata", []],
		];
		for (const [field, value] of wrongTypes) {
			expectValidationFailure({ title: "ok", [field]: value }, field);
		}
	});

	test("enforces category count/member boundaries and preserves members exactly", () => {
		const exact = Array.from({ length: 25 }, (_, index) => `category-${index}`);
		expect(
			webhook.validateWebhookPayload({ title: "ok", categories: exact })
				.categories,
		).toEqual(exact);
		expectValidationFailure(
			{ title: "ok", categories: [...exact, "category-25"] },
			"categories",
			undefined,
			"25",
		);
		expectValidationFailure({ title: "ok", categories: [" "] }, "categories");
		expectValidationFailure(
			{ title: "ok", categories: ["x", 4] },
			"categories",
		);
	});

	test("accepts only absolute HTTP(S) URLs and valid dates", () => {
		const valid = [
			"http://example.test/path",
			"https://example.test/path?q=1#fragment",
		];
		for (const url of valid)
			expect(webhook.validateWebhookPayload({ title: "ok", url }).url).toBe(
				url,
			);

		for (const url of [
			"ftp://example.test/file",
			"file:///tmp/file",
			"/relative/path",
			"//example.test/path",
			"https://user:password@example.test/private",
		]) {
			expectValidationFailure({ title: "ok", url }, "url");
		}

		const dateAtLimit = `Thu, 10 Sep 2026 12:34:56 GMT ${"(foo)".repeat(6)}(xx)`;
		expect(
			webhook.validateWebhookPayload({ title: "ok", date: dateAtLimit }).date,
		).toBe(dateAtLimit);
		expectValidationFailure(
			{
				title: "ok",
				date: `Thu, 10 Sep 2026 12:34:56 GMT ${"(foo)".repeat(6)}(xxx)`,
			},
			"date",
			undefined,
			"64",
		);
		expectValidationFailure({ title: "ok", date: "not-a-date" }, "date");
		expectValidationFailure(
			{ title: "ok", date: "2026-09-10T12:34:56Z-invalid" },
			"date",
		);
		expectValidationFailure(
			{ title: "ok", date: "2026-02-30T12:00:00Z" },
			"date",
		);
	});

	test("accepts exactly the four documented severity values and rejects all others", () => {
		for (const severity of ["info", "success", "warning", "error"] as const) {
			expect(
				webhook.validateWebhookPayload({ title: "ok", severity }).severity,
			).toBe(severity);
		}
		expectValidationFailure({ title: "ok", severity: "critical" }, "severity");
		expectValidationFailure({ title: "ok", severity: "" }, "severity");
	});

	test("bounds metadata depth and contained key/array-element count", () => {
		expect(
			webhook.validateWebhookPayload({
				title: "ok",
				metadata: nestedMetadata(8),
			}).metadata,
		).toEqual(nestedMetadata(8));
		expectValidationFailure(
			{ title: "ok", metadata: nestedMetadata(9) },
			"metadata",
			undefined,
			"8",
		);
		expect(
			webhook.validateWebhookPayload({
				title: "ok",
				metadata: metadataWithKeys(1_024),
			}).metadata,
		).toEqual(metadataWithKeys(1_024));
		expectValidationFailure(
			{ title: "ok", metadata: metadataWithKeys(1_025) },
			"metadata",
			undefined,
			/1(?:,?024)/,
		);
		expectValidationFailure(
			{
				title: "ok",
				metadata: { values: Array.from({ length: 1_025 }, () => "x") },
			},
			"metadata",
			undefined,
			/1(?:,?024)/,
		);
	});

	test("rejects cycles, non-JSON values, and prototype-pollution keys before persistence", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expectValidationFailure({ title: "ok", metadata: cyclic }, "metadata");
		expectValidationFailure(
			{ title: "ok", metadata: { functionValue: () => "secret" } },
			"metadata",
		);
		expectValidationFailure(
			{ title: "ok", metadata: { bigintValue: BigInt(1) } },
			"metadata",
		);
		for (const value of [
			undefined,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Symbol("p3-metadata-symbol"),
		]) {
			expectValidationFailure({ title: "ok", metadata: { value } }, "metadata");
		}

		for (const unsafeKey of ["__proto__", "prototype", "constructor"]) {
			const metadata = JSON.parse(`{"${unsafeKey}":"p3-secret"}`) as Record<
				string,
				unknown
			>;
			expectValidationFailure(
				{ title: "ok", metadata },
				"metadata",
				"p3-secret",
			);
		}
	});
});

describe("webhook normalization and runtime configuration", () => {
	test("normalizes dates according to strategy, preserves external IDs, and gates raw payload storage", () => {
		const receivedAt = new Date("2026-09-10T12:00:00.000Z");
		const payloadWithDate = webhook.validateWebhookPayload({
			id: "external-1",
			title: "With date",
			date: "2026-09-09T12:00:00.000Z",
			metadata: { status: "ok" },
		});
		const payloadWithoutDate = webhook.validateWebhookPayload({
			id: "external-2",
			title: "Without date",
		});

		const payloadDateEvent = webhook.normalizeWebhookEvent(
			"feed-1",
			payloadWithDate,
			configWith({
				dateStrategy: "payloadDateOrReceivedAt",
				storeRawPayload: false,
			}),
			receivedAt,
		);
		expect(payloadDateEvent.externalId).toBe("external-1");
		expect(payloadDateEvent.eventDate).toBe("2026-09-09T12:00:00.000Z");
		expect(payloadDateEvent.rawPayload).toBeUndefined();

		const fallbackEvent = webhook.normalizeWebhookEvent(
			"feed-1",
			payloadWithoutDate,
			configWith({
				dateStrategy: "payloadDateOrReceivedAt",
				storeRawPayload: true,
			}),
			receivedAt,
		);
		expect(fallbackEvent.eventDate).toBe(receivedAt.toISOString());
		expect(fallbackEvent.externalId).toBe("external-2");
		expect(fallbackEvent.rawPayload).toEqual(payloadWithoutDate);

		const receivedOnlyEvent = webhook.normalizeWebhookEvent(
			"feed-1",
			payloadWithDate,
			configWith({ dateStrategy: "receivedAt" }),
			receivedAt,
		);
		expect(receivedOnlyEvent.eventDate).toBe(receivedAt.toISOString());

		const hashOnlyPayload = webhook.validateWebhookPayload({
			title: "Hash-only",
		});
		const idOrHashA = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "idOrHash" }),
			receivedAt,
		);
		const idOrHashB = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "idOrHash" }),
			receivedAt,
		);
		expect(idOrHashA.dedupeKey).toBe(idOrHashB.dedupeKey);
		const idOnlyA = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "idOnly" }),
			receivedAt,
		);
		const idOnlyB = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "idOnly" }),
			new Date(receivedAt.getTime() + 1),
		);
		expect(idOnlyA.dedupeKey).toBe(idOnlyB.dedupeKey);
		const alwaysA = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "always" }),
			receivedAt,
		);
		const alwaysB = webhook.normalizeWebhookEvent(
			"feed-1",
			hashOnlyPayload,
			configWith({ duplicateStrategy: "always" }),
			receivedAt,
		);
		expect(alwaysA.dedupeKey).not.toBe(alwaysB.dedupeKey);

		expect(() =>
			webhook.normalizeWebhookEvent(
				"feed-1",
				payloadWithoutDate,
				configWith({ dateStrategy: "payloadDateOnly" }),
				receivedAt,
			),
		).toThrow(/date/i);
	});

	test("does not normalize invalid date input because validation rejects it first", () => {
		expectValidationFailure({ title: "bad-date", date: "2026-99-99" }, "date");
	});

	test("clamps storage ceilings while rejecting invalid runtime values", () => {
		const normalizeConfig = requireExport<
			(input: Record<string, unknown>) => Record<string, unknown>
		>(webhook, "normalizeWebhookFeedConfig");
		const valid = {
			...BASE_WEBHOOK_CONFIG,
			maxItems: 250,
			retentionDays: 90,
			duplicateStrategy: "idOnly",
			dateStrategy: "receivedAt",
			storeRawPayload: true,
		};
		expect(normalizeConfig(valid)).toMatchObject(valid);
		expect(normalizeConfig({ ...valid, maxItems: 1 }).maxItems).toBe(1);
		expect(normalizeConfig({ ...valid, maxItems: 1_000 }).maxItems).toBe(1_000);
		expect(normalizeConfig({ ...valid, retentionDays: 1 }).retentionDays).toBe(
			1,
		);
		expect(
			normalizeConfig({ ...valid, retentionDays: 3_650 }).retentionDays,
		).toBe(3_650);
		expect(normalizeConfig({ ...valid, maxItems: 2_000 }).maxItems).toBe(1_000);
		expect(
			normalizeConfig({ ...valid, retentionDays: 9_000 }).retentionDays,
		).toBe(3_650);

		for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => normalizeConfig({ ...valid, maxItems: value })).toThrow(
				/maxItems/i,
			);
			expect(() => normalizeConfig({ ...valid, retentionDays: value })).toThrow(
				/retentionDays/i,
			);
		}
	});
});

describe("managed webhook SQLite schema", () => {
	test("creates the event table with the required columns and semantic indexes", () => {
		const { sqlite } = openMigratedSqlite("schema");
		try {
			expect(tableRows(sqlite)).toHaveLength(1);
			expect(tableColumns(sqlite)).toEqual(
				expect.arrayContaining([
					"id",
					"feed_id",
					"external_id",
					"received_at",
					"event_date",
					"title",
					"description",
					"link",
					"author",
					"categories_json",
					"severity",
					"metadata_json",
					"raw_payload_json",
					"dedupe_key",
				]),
			);
			const columns = tableInfo(sqlite);
			expect(columns.find((column) => column.name === "id")?.pk).toBe(1);
			expect(
				columns.find((column) => column.name === "external_id")?.notnull,
			).toBe(0);

			const indexes = sqlite
				.query("PRAGMA index_list(webhook_feed_events)")
				.all() as Array<{
				name: string;
				unique: number;
			}>;
			const indexColumnSets = indexes.map((index) => ({
				unique: index.unique === 1,
				columns: indexColumns(sqlite, index.name),
			}));
			expect(indexColumnSets).toEqual(
				expect.arrayContaining([
					{ unique: true, columns: ["feed_id", "dedupe_key"] },
					{ unique: false, columns: ["feed_id", "event_date"] },
				]),
			);
		} finally {
			sqlite.close();
		}
	});
});

describe("transactional SQLite webhook event store", () => {
	test("inserts once, reports duplicates, and scopes dedupe by feed ID", async () => {
		const { sqlite } = openMigratedSqlite("dedupe");
		try {
			const store = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const eventA = makeEvent(
				"feed-a",
				"same-external-id",
				new Date("2026-09-10T11:00:00.000Z"),
			);
			const eventB = makeEvent(
				"feed-b",
				"same-external-id",
				new Date("2026-09-10T11:00:00.000Z"),
			);

			await expect(
				store.ingest("feed-a", eventA, { maxItems: 100, retentionDays: 30 }),
			).resolves.toEqual({
				duplicate: false,
			});
			await expect(
				store.ingest("feed-a", eventA, { maxItems: 100, retentionDays: 30 }),
			).resolves.toEqual({
				duplicate: true,
			});
			await expect(
				store.ingest("feed-b", eventB, { maxItems: 100, retentionDays: 30 }),
			).resolves.toEqual({
				duplicate: false,
			});

			expect(await store.read("feed-a", 100)).toHaveLength(1);
			expect(await store.read("feed-b", 100)).toHaveLength(1);
		} finally {
			sqlite.close();
		}
	});

	test("clamps hard storage ceilings and rejects invalid policies at the store boundary", async () => {
		const now = new Date("2026-09-10T12:00:00.000Z");
		const { sqlite } = openMigratedSqlite("store-policy-ceilings");
		try {
			const store = createStore(sqlite, { clock: () => now });
			const overCeiling = { maxItems: 1_001, retentionDays: 3_651 };
			// Seed neighboring durable rows in one test-owned transaction; the real
			// store boundary below still performs the over-ceiling clamp.
			seedWebhookEvents(
				sqlite,
				Array.from({ length: 1_001 }, (_, index) =>
					makeEvent(
						"feed-max-ceiling",
						`event-${index}`,
						new Date(now.getTime() - index),
					),
				),
			);
			await store.ingest(
				"feed-max-ceiling",
				makeEvent("feed-max-ceiling", "ceiling-probe", now),
				overCeiling,
			);
			expect(await store.read("feed-max-ceiling", 2_000)).toHaveLength(1_000);

			const tooOld = makeEvent(
				"feed-retention-ceiling",
				"too-old",
				new Date(now.getTime() - 3_650 * DAY_MS - 1),
			);
			await store.ingest("feed-retention-ceiling", tooOld, {
				maxItems: 10,
				retentionDays: 3_651,
			});
			expect(await store.read("feed-retention-ceiling", 100)).toHaveLength(0);

			const invalidPolicies: Array<{
				maxItems: number;
				retentionDays: number;
			}> = [
				{ maxItems: 0, retentionDays: 30 },
				{ maxItems: -1, retentionDays: 30 },
				{ maxItems: 1.5, retentionDays: 30 },
				{ maxItems: Number.NaN, retentionDays: 30 },
				{ maxItems: Number.POSITIVE_INFINITY, retentionDays: 30 },
				{ maxItems: 100, retentionDays: 0 },
				{ maxItems: 100, retentionDays: -1 },
				{ maxItems: 100, retentionDays: 1.5 },
				{ maxItems: 100, retentionDays: Number.NaN },
				{ maxItems: 100, retentionDays: Number.POSITIVE_INFINITY },
				{ maxItems: 100, retentionDays: Number.NEGATIVE_INFINITY },
			];
			for (const [index, policy] of invalidPolicies.entries()) {
				await expect(
					store.ingest(
						"feed-invalid-policy",
						makeEvent("feed-invalid-policy", `invalid-${index}`, now),
						policy,
					),
				).rejects.toThrow();
			}
			expect(await store.read("feed-invalid-policy", 100)).toHaveLength(0);
		} finally {
			sqlite.close();
		}
	});

	test("concurrent duplicate ingestion produces one row without uniqueness races", async () => {
		const { sqlite, dbPath } = openMigratedSqlite("concurrent-duplicate");
		const sqlite2 = new Database(dbPath);
		try {
			const db2 = drizzle(sqlite2, { schema: analyticsSchema });
			migrate(db2, { migrationsFolder: REAL_MIGRATIONS_DIR });
			const storeA = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const storeB = createStore(sqlite2, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const event = makeEvent(
				"feed-concurrent",
				"same",
				new Date("2026-09-10T11:59:00.000Z"),
			);

			const results = await Promise.all(
				Array.from({ length: 12 }, (_, index) =>
					(index % 2 === 0 ? storeA : storeB).ingest("feed-concurrent", event, {
						maxItems: 100,
						retentionDays: 30,
					}),
				),
			);
			expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
			expect(results.filter((result) => result.duplicate)).toHaveLength(11);
			expect(await storeA.read("feed-concurrent", 100)).toHaveLength(1);
		} finally {
			sqlite2.close();
			sqlite.close();
		}
	});

	test("concurrent distinct ingestion does not lose events", async () => {
		const { sqlite, dbPath } = openMigratedSqlite("concurrent-distinct");
		const sqlite2 = new Database(dbPath);
		try {
			const db2 = drizzle(sqlite2, { schema: analyticsSchema });
			migrate(db2, { migrationsFolder: REAL_MIGRATIONS_DIR });
			const storeA = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const storeB = createStore(sqlite2, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const events = Array.from({ length: 12 }, (_, index) =>
				makeEvent(
					"feed-distinct",
					`distinct-${index}`,
					new Date(`2026-09-10T11:${String(index).padStart(2, "0")}:00.000Z`),
				),
			);
			await Promise.all(
				events.map((event, index) =>
					(index % 2 === 0 ? storeA : storeB).ingest("feed-distinct", event, {
						maxItems: 100,
						retentionDays: 30,
					}),
				),
			);
			const rows = await storeA.read("feed-distinct", 100);
			expect(rows).toHaveLength(events.length);
			expect(rows.map((row) => row.externalId)).toEqual(
				events.map((event) => event.externalId).reverse(),
			);
		} finally {
			sqlite2.close();
			sqlite.close();
		}
	});

	test("enforces age and count retention during ingestion with a controlled clock", async () => {
		const now = new Date("2026-09-10T12:00:00.000Z");
		const { sqlite } = openMigratedSqlite("retention");
		try {
			const store = createStore(sqlite, { clock: () => now });
			const policy = { maxItems: 2, retentionDays: 1 };
			const old = makeEvent(
				"feed-retention",
				"old",
				new Date(now.getTime() - DAY_MS - 1),
			);
			const boundary = makeEvent(
				"feed-retention",
				"boundary",
				new Date(now.getTime() - DAY_MS),
			);
			const newest = makeEvent(
				"feed-retention",
				"newest",
				new Date(now.getTime() - 1),
			);
			const newest2 = makeEvent("feed-retention", "newest-2", now);

			await store.ingest("feed-retention", old, policy);
			await store.ingest("feed-retention", boundary, policy);
			expect(
				(await store.read("feed-retention", 100)).map((row) => row.externalId),
			).toEqual(["boundary"]);
			await store.ingest("feed-retention", newest, policy);
			expect(
				(await store.read("feed-retention", 100)).map((row) => row.externalId),
			).toEqual(["newest", "boundary"]);
			await store.ingest("feed-retention", newest2, policy);
			expect(
				(await store.read("feed-retention", 100)).map((row) => row.externalId),
			).toEqual(["newest-2", "newest"]);

			// A different feed's retention is unaffected.
			const other = makeEvent("other-feed", "other", now);
			await store.ingest("other-feed", other, {
				maxItems: 1,
				retentionDays: 1,
			});
			expect(await store.read("other-feed", 100)).toHaveLength(1);
		} finally {
			sqlite.close();
		}
	});

	test("enforces age and count retention even when ingestion is a duplicate", async () => {
		const now = new Date("2026-09-10T12:00:00.000Z");
		const { sqlite } = openMigratedSqlite("duplicate-retention");
		try {
			const store = createStore(sqlite, { clock: () => now });
			const relaxed = { maxItems: 100, retentionDays: 30 };
			const stale = makeEvent(
				"feed-duplicate-retention",
				"stale",
				new Date(now.getTime() - 2 * DAY_MS),
			);
			const excess = makeEvent(
				"feed-duplicate-retention",
				"excess",
				new Date(now.getTime() - 2 * 60 * 60 * 1_000),
			);
			const target = makeEvent(
				"feed-duplicate-retention",
				"target",
				new Date(now.getTime() - 60 * 60 * 1_000),
			);
			const newest = makeEvent(
				"feed-duplicate-retention",
				"newest",
				new Date(now.getTime() - 1),
			);
			for (const event of [stale, excess, target, newest]) {
				await store.ingest("feed-duplicate-retention", event, relaxed);
			}

			await expect(
				store.ingest("feed-duplicate-retention", target, {
					maxItems: 2,
					retentionDays: 1,
				}),
			).resolves.toEqual({ duplicate: true });
			expect(
				(await store.read("feed-duplicate-retention", 100)).map(
					(row) => row.externalId,
				),
			).toEqual(["newest", "target"]);
		} finally {
			sqlite.close();
		}
	});

	test("accepted SQLite ingestion leaves legacy JSONL history untouched", async () => {
		const legacyDir = join(
			uniqueFixtureDir("no-jsonl-rewrite"),
			"feed-state",
			"webhooks",
		);
		await mkdir(legacyDir, { recursive: true });
		const legacyPath = join(legacyDir, "feed-no-jsonl-rewrite.jsonl");
		const legacyContents = "legacy line must remain recoverable\n";
		await writeFile(legacyPath, legacyContents, "utf8");
		const { sqlite } = openMigratedSqlite("no-jsonl-rewrite-db");
		try {
			const store = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
				legacyDir,
			});
			await store.ingest(
				"feed-no-jsonl-rewrite",
				makeEvent(
					"feed-no-jsonl-rewrite",
					"sqlite-only",
					new Date("2026-09-10T12:00:00.000Z"),
				),
				{ maxItems: 10, retentionDays: 30 },
			);
			expect(await readFile(legacyPath, "utf8")).toBe(legacyContents);
		} finally {
			sqlite.close();
		}
	});

	test("orders reads newest-first and survives closing/reopening a real SQLite file", async () => {
		const now = new Date("2026-09-10T12:00:00.000Z");
		const { sqlite, dbPath } = openMigratedSqlite("restart");
		try {
			const store = createStore(sqlite, { clock: () => now });
			const older = makeEvent(
				"feed-restart",
				"older",
				new Date("2026-09-10T10:00:00.000Z"),
			);
			const newer = makeEvent(
				"feed-restart",
				"newer",
				new Date("2026-09-10T11:00:00.000Z"),
			);
			await store.ingest("feed-restart", newer, {
				maxItems: 10,
				retentionDays: 30,
			});
			await store.ingest("feed-restart", older, {
				maxItems: 10,
				retentionDays: 30,
			});
			expect(
				(await store.read("feed-restart", 10)).map((row) => row.externalId),
			).toEqual(["newer", "older"]);
			sqlite.close();

			const reopened = new Database(dbPath);
			try {
				const db = drizzle(reopened, { schema: analyticsSchema });
				migrate(db, { migrationsFolder: REAL_MIGRATIONS_DIR });
				const reopenedStore = createStore(reopened, { clock: () => now });
				expect(
					(await reopenedStore.read("feed-restart", 10)).map(
						(row) => row.externalId,
					),
				).toEqual(["newer", "older"]);
			} finally {
				reopened.close();
			}
		} finally {
			// The original connection may already be closed after the restart step.
			try {
				sqlite.close();
			} catch {
				// Bun throws when closing an already-closed handle; no state is lost.
			}
		}
	});

	test("rolls back insert and retention when the database aborts the operation", async () => {
		const { sqlite } = openMigratedSqlite("rollback");
		try {
			const store = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const existing = makeEvent(
				"feed-rollback",
				"existing",
				new Date("2026-09-10T11:00:00.000Z"),
			);
			const failed = makeEvent(
				"feed-rollback",
				"failed",
				new Date("2026-09-10T12:00:00.000Z"),
			);
			await store.ingest("feed-rollback", existing, {
				maxItems: 1,
				retentionDays: 30,
			});

			sqlite.run(`
        CREATE TRIGGER p3_webhook_abort_insert
        BEFORE INSERT ON webhook_feed_events
        BEGIN
          SELECT RAISE(ABORT, 'p3 forced webhook insert failure');
        END
      `);
			await expect(
				store.ingest("feed-rollback", failed, {
					maxItems: 1,
					retentionDays: 30,
				}),
			).rejects.toThrow();
			sqlite.run("DROP TRIGGER p3_webhook_abort_insert");

			expect(
				(await store.read("feed-rollback", 10)).map((row) => row.externalId),
			).toEqual(["existing"]);
		} finally {
			sqlite.close();
		}
	});

	test("rolls back a candidate insert when retention deletion aborts", async () => {
		const { sqlite } = openMigratedSqlite("rollback-retention");
		try {
			const store = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const old = makeEvent(
				"feed-rollback-retention",
				"old",
				new Date("2026-09-10T10:00:00.000Z"),
			);
			const current = makeEvent(
				"feed-rollback-retention",
				"current",
				new Date("2026-09-10T11:00:00.000Z"),
			);
			const candidate = makeEvent(
				"feed-rollback-retention",
				"candidate",
				new Date("2026-09-10T12:00:00.000Z"),
			);
			for (const event of [old, current]) {
				await store.ingest("feed-rollback-retention", event, {
					maxItems: 10,
					retentionDays: 30,
				});
			}

			sqlite.run(`
        CREATE TRIGGER p3_webhook_abort_retention_delete
        BEFORE DELETE ON webhook_feed_events
        WHEN OLD.feed_id = 'feed-rollback-retention'
        BEGIN
          SELECT RAISE(ABORT, 'p3 forced webhook retention failure');
        END
      `);
			await expect(
				store.ingest("feed-rollback-retention", candidate, {
					maxItems: 2,
					retentionDays: 30,
				}),
			).rejects.toThrow();
			sqlite.run("DROP TRIGGER p3_webhook_abort_retention_delete");

			expect(
				(await store.read("feed-rollback-retention", 10)).map(
					(row) => row.externalId,
				),
			).toEqual(["current", "old"]);
		} finally {
			sqlite.close();
		}
	});
});

describe("legacy webhook JSONL copy-forward", () => {
	test("initialization automatically copy-forwards legacy events before the first read", async () => {
		const root = uniqueFixtureDir("legacy-initialization");
		const legacyDir = join(root, "feed-state", "webhooks");
		await mkdir(legacyDir, { recursive: true });
		const legacyEvent = makeEvent(
			"feed-auto-init",
			"auto-init",
			new Date("2026-09-10T11:00:00.000Z"),
		);
		await writeFile(
			join(legacyDir, "feed-auto-init.jsonl"),
			`${JSON.stringify(legacyEvent)}\n`,
			"utf8",
		);
		const sqliteState = openMigratedSqlite("legacy-initialization-db");
		try {
			const store = createStore(sqliteState.sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
				legacyDir,
			});
			expect(
				(await store.read("feed-auto-init", 100)).map((row) => row.externalId),
			).toEqual(["auto-init"]);
		} finally {
			sqliteState.sqlite.close();
		}
	});

	test("imports valid neighbors, skips malformed/unsafe files, deduplicates repeat runs, and preserves source files", async () => {
		const root = uniqueFixtureDir("legacy-migration");
		const legacyDir = join(root, "feed-state", "webhooks");
		await mkdir(legacyDir, { recursive: true });
		const sqliteState = openMigratedSqlite("legacy-db");

		try {
			const existingStore = createStore(sqliteState.sqlite, { legacyDir });
			const existing = makeEvent(
				"feed-existing",
				"already-there",
				new Date("2026-09-10T10:00:00.000Z"),
			);
			await existingStore.ingest("feed-existing", existing, {
				maxItems: 100,
				retentionDays: 30,
			});

			const importedA = makeEvent(
				"feed-a",
				"a",
				new Date("2026-09-10T10:01:00.000Z"),
			);
			const importedB = makeEvent(
				"feed-b",
				"b",
				new Date("2026-09-10T10:02:00.000Z"),
			);
			const conflictingLegacy = {
				...existing,
				title: "legacy-conflict-payload-must-not-win",
			};
			const unsafeEvent = makeEvent(
				"feed-unsafe",
				"unsafe-file-event",
				new Date("2026-09-10T10:03:00.000Z"),
			);
			const feedAContents = `${[
				JSON.stringify(importedA),
				JSON.stringify(importedA),
				"{malformed legacy line",
			].join("\n")}\n`;
			const feedBContents = `${JSON.stringify(importedB)}\n`;
			const conflictContents = `${JSON.stringify(conflictingLegacy)}\n`;
			const unsafeContents = `${JSON.stringify(unsafeEvent)}\n`;
			const malformedContents = "not-json\n";
			await writeFile(join(legacyDir, "feed-a.jsonl"), feedAContents, "utf8");
			await writeFile(join(legacyDir, "feed-b.jsonl"), feedBContents, "utf8");
			await writeFile(
				join(legacyDir, "feed-existing.jsonl"),
				conflictContents,
				"utf8",
			);
			await writeFile(
				join(legacyDir, "unsafe..id.jsonl"),
				unsafeContents,
				"utf8",
			);
			await writeFile(
				join(legacyDir, "feed-bad.jsonl"),
				malformedContents,
				"utf8",
			);

			const result = await existingStore.migrateLegacy();
			expect(migrationCount(result)).toBe(2);
			expect(JSON.stringify(result)).not.toContain(
				"legacy-conflict-payload-must-not-win",
			);
			expect(JSON.stringify(result)).not.toContain(legacyDir);
			const evidence = sqliteState.sqlite
				.query("SELECT name, details_json FROM runtime_migrations")
				.all() as Array<{ name: string; details_json: string | null }>;
			expect(evidence.length).toBeGreaterThan(0);
			expect(JSON.stringify(evidence)).not.toContain(
				"legacy-conflict-payload-must-not-win",
			);
			expect(JSON.stringify(evidence)).not.toContain(legacyDir);

			expect(await existingStore.read("feed-a", 100)).toHaveLength(1);
			expect(await existingStore.read("feed-b", 100)).toHaveLength(1);
			expect(await existingStore.read("feed-unsafe", 100)).toHaveLength(0);
			expect(await existingStore.read("feed-bad", 100)).toHaveLength(0);
			expect((await existingStore.read("feed-existing", 100))[0]?.title).toBe(
				existing.title,
			);
			expect(existsSync(join(legacyDir, "feed-a.jsonl"))).toBe(true);
			expect(await readFile(join(legacyDir, "feed-a.jsonl"), "utf8")).toBe(
				feedAContents,
			);
			expect(await readFile(join(legacyDir, "feed-b.jsonl"), "utf8")).toBe(
				feedBContents,
			);
			expect(
				await readFile(join(legacyDir, "feed-existing.jsonl"), "utf8"),
			).toBe(conflictContents);
			expect(await readFile(join(legacyDir, "unsafe..id.jsonl"), "utf8")).toBe(
				unsafeContents,
			);
			expect(await readFile(join(legacyDir, "feed-bad.jsonl"), "utf8")).toBe(
				malformedContents,
			);

			const secondResult = await existingStore.migrateLegacy();
			expect(migrationCount(secondResult)).toBe(0);
			expect(await existingStore.read("feed-a", 100)).toHaveLength(1);
			expect(await existingStore.read("feed-b", 100)).toHaveLength(1);
		} finally {
			sqliteState.sqlite.close();
		}
	});
});

describe("webhook route auth, media type, errors, and rate policy", () => {
	test("preserves one-way bearer hashing and timing-safe verification semantics", () => {
		const token = webhook.generateWebhookToken();
		const digest = webhook.hashWebhookToken(token);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(digest).not.toContain(token);
		expect(webhook.verifyWebhookToken(token, digest)).toBe(true);
		expect(webhook.verifyWebhookToken(`${token}-wrong`, digest)).toBe(false);
		expect(webhook.verifyWebhookToken("", digest)).toBe(false);
	});

	test("accepts credentials only in one Authorization Bearer header and uses one generic 401 response", async () => {
		const fixture = await writeRouteFixture("auth");
		const router = webhookRouterFor(fixture.configsDir, () => 1_000_000);
		const body = JSON.stringify({});
		const requests: Array<{
			headers?: Record<string, string>;
			query?: string;
		}> = [
			{},
			{ headers: { authorization: "Basic abc" } },
			{ headers: { authorization: "Bearer wrong-token" } },
			{ query: `?token=${encodeURIComponent(fixture.token)}` },
			{
				headers: {
					authorization: `Bearer ${fixture.token}, Bearer ${fixture.token}`,
				},
			},
		];

		const responses = await Promise.all(
			requests.map(({ headers, query }) =>
				routeRequest(
					router,
					fixture.slug,
					{ headers: { "content-type": "application/json", ...headers }, body },
					query,
				),
			),
		);
		const bodies = await Promise.all(
			responses.map((response) => response.text()),
		);
		expect(responses.map((response) => response.status)).toEqual([
			401, 401, 401, 401, 401,
		]);
		expect(new Set(bodies).size).toBe(1);
		for (const responseBody of bodies) {
			expect(responseBody).not.toContain(fixture.token);
			expect(responseBody).not.toContain(fixture.slug);
		}
	});

	test("requires application/json, allows charset parameters, and returns sanitized stable 400s", async () => {
		const fixture = await writeRouteFixture("media");
		const router = webhookRouterFor(fixture.configsDir, () => 2_000_000);
		const auth = { authorization: `Bearer ${fixture.token}` };
		const wrongMediaTypes = ["text/plain", "application/x-www-form-urlencoded"];
		const mediaResponses = await Promise.all(
			wrongMediaTypes.map((contentType) =>
				routeRequest(router, fixture.slug, {
					headers: { ...auth, "content-type": contentType },
					body: "{",
				}),
			),
		);
		const mediaBodies = await Promise.all(
			mediaResponses.map((response) => response.text()),
		);
		expect(mediaResponses.map((response) => response.status)).toEqual([
			415, 415,
		]);
		expect(new Set(mediaBodies).size).toBe(1);
		const missingMedia = await routeRequest(router, fixture.slug, {
			headers: auth,
		});
		const missingMediaBody = await missingMedia.text();
		expect(missingMedia.status).toBe(415);
		expect(missingMediaBody).toBe(mediaBodies[0]);

		const malformed = await routeRequest(router, fixture.slug, {
			headers: { ...auth, "content-type": "application/json; charset=utf-8" },
			body: '{"title":"p3-route-secret',
		});
		const malformedBody = await malformed.text();
		expect(malformed.status).toBe(400);
		expect(malformedBody).not.toContain("p3-route-secret");
		expect(malformedBody).not.toContain(fixture.token);
		expect(malformedBody).not.toContain(fixture.slug);

		const invalidField = await routeRequest(router, fixture.slug, {
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ title: "p3-route-secret".repeat(30) }),
		});
		const invalidFieldBody = await invalidField.text();
		expect(invalidField.status).toBe(400);
		expect(invalidFieldBody).not.toContain("p3-route-secret");
		expect(invalidFieldBody).not.toContain(fixture.token);
		expect(invalidFieldBody).not.toContain(fixture.slug);
		expect(invalidFieldBody).toBe(malformedBody);
	});

	test("sanitizes persistence failures without reflecting database details or paths", async () => {
		const fixture = await writeRouteFixture("persistence-error");
		const requestBody = JSON.stringify({ title: "Persistence failure" });
		const failingStore = (message: string) => ({
			ingest: async () => {
				throw new Error(message);
			},
			read: async () => [],
		});
		const routers = [
			webhookRouterFor(fixture.configsDir, () => 2_500_000, {
				eventStore: failingStore(
					"SQLITE_BUSY: p3-db-secret at /srv/mkfd/runtime.db",
				),
			}),
			webhookRouterFor(fixture.configsDir, () => 2_500_000, {
				eventStore: failingStore(
					"constraint failed: p3-other-db-secret at /var/lib/mkfd/runtime.db",
				),
			}),
		];
		try {
			const responses = await Promise.all(
				routers.map((router) =>
					routeRequest(router, fixture.slug, {
						headers: {
							authorization: `Bearer ${fixture.token}`,
							"content-type": "application/json",
						},
						body: requestBody,
					}),
				),
			);
			const bodies = await Promise.all(
				responses.map((response) => response.text()),
			);
			expect(responses.map((response) => response.status)).toEqual([400, 400]);
			expect(bodies[0]).toBe(bodies[1]);
			for (const body of bodies) {
				expect(body).not.toContain("p3-db-secret");
				expect(body).not.toContain("p3-other-db-secret");
				expect(body).not.toContain("/srv/mkfd/runtime.db");
				expect(body).not.toContain("/var/lib/mkfd/runtime.db");
				expect(body).not.toMatch(/SQLITE|constraint failed|stack|at /i);
			}
		} finally {
			// The pre-change route falls back to repository paths when it ignores
			// the injected store; clean only this test's unique artifacts on RED.
			await Promise.all([
				rm(
					join(REPO_ROOT, "feed-state", "webhooks", `${fixture.feedId}.jsonl`),
					{ force: true },
				),
				...(["xml", "atom", "json"] as const).map((extension) =>
					rm(
						join(
							REPO_ROOT,
							"public",
							"feeds",
							`${fixture.feedId}.${extension}`,
						),
						{ force: true },
					),
				),
			]);
		}
	});

	test("permits 60 requests per slug, rejects the 61st, isolates slugs, and resets at the exact boundary", async () => {
		const fixture = await writeRouteFixture("rate");
		const secondFixture = await writeRouteFixture("rate-other");
		let now = 3_000_000;
		const router = webhookRouterFor(fixture.configsDir, () => now);
		// The second fixture lives in another config directory, so add its config
		// to the same directory for a true per-slug isolation check.
		const secondConfig = await readFile(
			join(secondFixture.configsDir, `${secondFixture.feedId}.yaml`),
			"utf8",
		);
		await writeFile(
			join(fixture.configsDir, `${secondFixture.feedId}.yaml`),
			secondConfig,
			"utf8",
		);

		const invalidRequest = (slug: string) =>
			routeRequest(router, slug, {
				headers: {
					authorization: "Bearer deliberately-invalid",
					"content-type": "application/json",
				},
				body: "{}",
			});

		for (let index = 0; index < 60; index += 1) {
			const response = await invalidRequest(fixture.slug);
			await response.text();
			expect(response.status).toBe(401);
		}
		const sixtyFirst = await invalidRequest(fixture.slug);
		await sixtyFirst.text();
		expect(sixtyFirst.status).toBe(429);

		const otherSlugResponse = await invalidRequest(secondFixture.slug);
		await otherSlugResponse.text();
		expect(otherSlugResponse.status).toBe(401);

		now += MINUTE_MS;
		const afterBoundary = await invalidRequest(fixture.slug);
		await afterBoundary.text();
		expect(afterBoundary.status).toBe(401);
	});

	test("inserts once, regenerates output from SQLite, and returns an idempotent duplicate response", async () => {
		const fixture = await writeRouteFixture("output-route");
		const sqliteState = openMigratedSqlite("output-route-db");
		const outputDir = join(uniqueFixtureDir("output-route-files"), "feeds");
		const clock = () => 4_000_000;
		const configPath = join(fixture.configsDir, `${fixture.feedId}.yaml`);
		const yamlBefore = await readFile(configPath, "utf8");
		const body = JSON.stringify({
			id: "route-event-1",
			title: "Route event one",
			description: "Persisted through the managed event store",
			date: "2026-09-10T11:59:00.000Z",
		});

		try {
			const store = createStore(sqliteState.sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const router = webhookRouterFor(fixture.configsDir, clock, {
				eventStore: store,
				outputDir,
			});
			const first = await routeRequest(router, fixture.slug, {
				headers: {
					authorization: `Bearer ${fixture.token}`,
					"content-type": "application/json",
				},
				body,
			});
			const firstJson = (await first.json()) as Record<string, unknown>;
			expect(first.status).toBe(200);
			expect(firstJson.ok).toBe(true);
			expect(firstJson.duplicate).toBe(false);
			expect(typeof firstJson.eventId).toBe("string");
			expect(firstJson.feedUrl).toBe(`/public/feeds/${fixture.feedId}.xml`);

			const rowsAfterFirst = await store.read(fixture.feedId, 100);
			expect(rowsAfterFirst).toHaveLength(1);
			expect(rowsAfterFirst[0]?.title).toBe("Route event one");
			const xmlAfterFirst = await readFile(
				join(outputDir, `${fixture.feedId}.xml`),
				"utf8",
			);
			expect(xmlAfterFirst).toContain("Route event one");

			const duplicate = await routeRequest(router, fixture.slug, {
				headers: {
					authorization: `Bearer ${fixture.token}`,
					"content-type": "application/json",
				},
				body,
			});
			const duplicateJson = (await duplicate.json()) as Record<string, unknown>;
			expect(duplicate.status).toBe(200);
			expect(duplicateJson.ok).toBe(true);
			expect(duplicateJson.duplicate).toBe(true);
			expect(duplicateJson.feedUrl).toBe(`/public/feeds/${fixture.feedId}.xml`);
			expect(await store.read(fixture.feedId, 100)).toHaveLength(1);
			expect(
				await readFile(join(outputDir, `${fixture.feedId}.xml`), "utf8"),
			).toBe(xmlAfterFirst);

			// YAML remains the configuration authority; runtime events do not get
			// written back to the saved feed definition.
			expect(await readFile(configPath, "utf8")).toBe(yamlBefore);
			expect(yamlBefore).toContain(hashWebhookToken(fixture.token));
			expect(yamlBefore).not.toContain(fixture.token);
		} finally {
			sqliteState.sqlite.close();
		}
	});
});

describe("webhook event output compatibility", () => {
	test("reads normalized persisted events into the existing item mapping without leaking raw payload by default", async () => {
		const { sqlite } = openMigratedSqlite("output");
		try {
			const store = createStore(sqlite, {
				clock: () => new Date("2026-09-10T12:00:00.000Z"),
			});
			const config = configWith({ maxItems: 2, storeRawPayload: false });
			const first = makeEvent(
				"feed-output",
				"first",
				new Date("2026-09-10T10:00:00.000Z"),
				config,
			);
			const second = makeEvent(
				"feed-output",
				"second",
				new Date("2026-09-10T11:00:00.000Z"),
				config,
			);
			await store.ingest("feed-output", first, {
				maxItems: 2,
				retentionDays: 30,
			});
			await store.ingest("feed-output", second, {
				maxItems: 2,
				retentionDays: 30,
			});
			const persisted = await store.read("feed-output", 2);
			expect(persisted.map((event) => event.externalId)).toEqual([
				"second",
				"first",
			]);
			expect(persisted.every((event) => event.rawPayload === undefined)).toBe(
				true,
			);

			const items = webhook.buildWebhookItems(persisted, config);
			expect(items.map((item) => item.title)).toEqual([
				"Event second",
				"Event first",
			]);
			expect(items[0]).toMatchObject({
				guid: persisted[0]?.id,
				pubDate: persisted[0]?.eventDate,
				categories: persisted[0]?.categories,
			});
			expect(items[0]?.raw).toEqual(persisted[0]);
		} finally {
			sqlite.close();
		}
	});
});
