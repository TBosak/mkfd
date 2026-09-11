import { join } from "node:path";
import { Hono } from "hono";
import {
	createWebhookEventStore,
	getDb,
	type WebhookEventStore,
} from "../lib/analytics/db";
import type { WebhookFeedConfig as WebhookFeedDefinition } from "../models/feed-config.model";
import {
	listFeedConfigs,
	readFeedConfig,
} from "../utilities/config-manager.utility";
import { writeAllFeedFormats } from "../utilities/feed-output.utility";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";
import {
	buildWebhookItems,
	normalizeWebhookEvent,
	normalizeWebhookFeedConfig,
	validateWebhookPayload,
	verifyWebhookToken,
} from "../utilities/webhook-feed.utility";

const DEFAULT_EVENT_DIR = join(__dirname, "../feed-state/webhooks");
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const UNAUTHORIZED = { ok: false, error: "Unauthorized" } as const;
const INVALID_REQUEST = {
	ok: false,
	error: "Invalid webhook request",
} as const;

type WebhookRouterDependencies = {
	configsDir: string;
	clock?: () => number;
	eventStore?: Pick<WebhookEventStore, "ingest" | "read">;
	outputDir?: string;
};

type RateWindow = { count: number; startedAt: number };

export function webhookFeedRouter(deps: WebhookRouterDependencies): Hono {
	const app = new Hono();
	const clock = deps.clock ?? Date.now;
	const rateWindows = new Map<string, RateWindow>();
	let defaultStore: WebhookEventStore | undefined;
	const eventStore = (): Pick<WebhookEventStore, "ingest" | "read"> => {
		if (deps.eventStore) return deps.eventStore;
		defaultStore ??= createWebhookEventStore(getDb(), {
			legacyDir: DEFAULT_EVENT_DIR,
		});
		return defaultStore;
	};

	app.post("/webhook-feeds/:slug", async (ctx) => {
		const slug = ctx.req.param("slug");
		const feedConfig = await findWebhookFeed(slug, deps.configsDir);
		if (!feedConfig) {
			return ctx.json({ ok: false, error: "Webhook feed not found" }, 404);
		}

		if (!consumeRateBudget(rateWindows, slug, clock())) {
			return ctx.json({ ok: false, error: "Too many webhook requests" }, 429);
		}

		const token = bearerToken(ctx.req.header("authorization"));
		if (
			!token ||
			!verifyWebhookToken(token, feedConfig.webhookFeed.tokenHash)
		) {
			return ctx.json(UNAUTHORIZED, 401);
		}

		const mediaType = (ctx.req.header("content-type") ?? "")
			.split(";", 1)[0]
			.trim()
			.toLowerCase();
		if (mediaType !== "application/json") {
			return ctx.json(
				{ ok: false, error: "Webhook requests require application/json" },
				415,
			);
		}

		try {
			const config = normalizeWebhookFeedConfig(feedConfig.webhookFeed);
			const payload = validateWebhookPayload(await ctx.req.json());
			const event = normalizeWebhookEvent(
				feedConfig.feedId,
				payload,
				config,
				new Date(clock()),
			);
			const store = eventStore();
			const result = await store.ingest(feedConfig.feedId, event, {
				maxItems: config.maxItems,
				retentionDays: config.retentionDays,
			});
			if (!result.duplicate) {
				const events = await store.read(feedConfig.feedId, config.maxItems);
				const feed = buildFeedFromNormalizedItems({
					feedId: feedConfig.feedId,
					feedName: feedConfig.feedName,
					items: buildWebhookItems(events, config),
				});
				await writeAllFeedFormats(feedConfig.feedId, feed, deps.outputDir);
			}
			return ctx.json({
				ok: true,
				eventId: event.id,
				duplicate: result.duplicate,
				feedUrl: `/public/feeds/${feedConfig.feedId}.xml`,
			});
		} catch {
			return ctx.json(INVALID_REQUEST, 400);
		}
	});

	return app;
}

async function findWebhookFeed(
	slug: string,
	configsDir: string,
): Promise<WebhookFeedDefinition | undefined> {
	for (const file of await listFeedConfigs(configsDir)) {
		const config = await readFeedConfig(file.id, configsDir);
		if (config.feedType === "webhook" && config.webhookFeed.slug === slug) {
			return config;
		}
	}
	return undefined;
}

function bearerToken(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer ([^\s,]+)$/i.exec(header);
	return match?.[1];
}

function consumeRateBudget(
	windows: Map<string, RateWindow>,
	slug: string,
	now: number,
): boolean {
	const current = windows.get(slug);
	if (
		!current ||
		now - current.startedAt >= RATE_WINDOW_MS ||
		now < current.startedAt
	) {
		windows.set(slug, { count: 1, startedAt: now });
		return true;
	}
	if (current.count >= RATE_LIMIT) return false;
	current.count += 1;
	return true;
}
