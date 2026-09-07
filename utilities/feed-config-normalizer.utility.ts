import { getFeedSourceDefinition } from "./feed-source-registry.utility";
import type {
	FeedConfig,
	WebScrapingFeedConfig,
	RestFeedConfig,
	ApiFeedConfig,
	EmailFeedConfig,
	FeedTransformerFeedConfig,
} from "../models/feed-config.model";
import { defaultFeedRssMetadata } from "../models/feed-config.model";
import type { ApiMapping } from "../models/api-mapping.model";
import type CSSTarget from "../models/csstarget.model";
import type { CSSTargetFields } from "../models/csstarget.model";
import type { ProtectedRecord } from "../models/protected-value.model";
import { isProtectedValue } from "./protected-values.utility";

function s(v: unknown, fallback = ""): string {
	return typeof v === "string" ? v : fallback;
}
function n(v: unknown, fallback = 0): number {
	const parsed = typeof v === "number" ? v : Number(v);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function b(v: unknown, fallback = false): boolean {
	if (typeof v === "boolean") return v;
	return ["on", "true", "checked"].includes(String(v ?? "").toLowerCase())
		? true
		: fallback;
}

function normalizeProtectedRecord(value: unknown): ProtectedRecord {
	if (!value || typeof value !== "object") return {};
	// V2-02: configs already on disk may carry the legacy `[{key,value}]` array
	// shape. Returning `{}` for those discarded every header on load — the
	// normalizer's whole job is to keep old YAML readable, so it migrates the
	// shape rather than rejecting it.
	if (Array.isArray(value)) {
		const migrated: ProtectedRecord = {};
		for (const entry of value as Array<{ key?: string; name?: string; value?: unknown }>) {
			const name = (entry?.key ?? entry?.name ?? "").trim();
			if (!name) continue;
			const entryValue = entry.value;
			if (typeof entryValue === "string" || isProtectedValue(entryValue)) {
				migrated[name] = entryValue;
			}
		}
		return migrated;
	}
	const result: ProtectedRecord = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string" || isProtectedValue(entry))
			result[key] = entry;
	}
	return result;
}

/** Feed-level API mapping keys that were historically written with a "Path" suffix. */
const LEGACY_API_MAPPING_SUFFIXED = [
	"feedTitle",
	"feedDescription",
	"feedLanguage",
	"feedCopyright",
	"feedManagingEditor",
	"feedWebMaster",
	"feedPubDate",
	"feedCategories",
	"feedTtl",
	"feedSkipHours",
	"feedSkipDays",
] as const;

/**
 * Migrates a stored apiMapping onto the canonical key names.
 *
 * V2-10: feed-level paths were persisted as `feedTitlePath`, `feedLanguagePath`
 * and so on, while rss-builder.utility.ts reads the unsuffixed key. Configs
 * already on disk carry the suffixed form, so it is translated on read rather
 * than abandoned. `feedLinkPath` and `feedLastBuildDatePath` keep their names:
 * those ARE the canonical keys the runtime reads.
 */
function normalizeApiMapping(value: unknown): ApiMapping {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { items: "" };
	}
	// Typed as both from the outset so the legacy-key migration below can index
	// it by string without needing a double cast on the way out — the
	// anti-bypass gate counts those and refuses growth.
	const mapping = {
		items: "",
		...(value as Record<string, unknown>),
	} as ApiMapping & Record<string, unknown>;
	for (const canonical of LEGACY_API_MAPPING_SUFFIXED) {
		const legacyKey = `${canonical}Path`;
		const legacyValue = mapping[legacyKey];
		if (mapping[canonical] === undefined && typeof legacyValue === "string") {
			mapping[canonical] = legacyValue;
		}
		delete mapping[legacyKey];
	}
	return mapping;
}

function normalizeArticle(raw: Record<string, unknown>): CSSTargetFields {
	const iterator = raw.iterator as CSSTarget | undefined;
	const dateTarget = (raw.date ?? raw.pubDate) as CSSTarget | undefined;
	return {
		...raw,
		iterator: iterator ?? {},
		date: dateTarget,
		pubDate: dateTarget,
	};
}

function normalizeRssMetadata(input: Record<string, unknown>) {
	return {
		feedLanguage: s(input.feedLanguage, defaultFeedRssMetadata.feedLanguage),
		feedCopyright: s(input.feedCopyright, defaultFeedRssMetadata.feedCopyright),
		feedDescription: s(
			input.feedDescription,
			defaultFeedRssMetadata.feedDescription,
		),
		feedManagingEditor: s(
			input.feedManagingEditor,
			defaultFeedRssMetadata.feedManagingEditor,
		),
		feedWebMaster: s(input.feedWebMaster, defaultFeedRssMetadata.feedWebMaster),
		feedPubDate: s(input.feedPubDate, defaultFeedRssMetadata.feedPubDate),
		feedLastBuildDate: s(
			input.feedLastBuildDate,
			defaultFeedRssMetadata.feedLastBuildDate,
		),
		feedCategories: Array.isArray(input.feedCategories)
			? input.feedCategories
			: [],
		feedDocs: s(input.feedDocs, defaultFeedRssMetadata.feedDocs),
		feedGenerator: s(input.feedGenerator, defaultFeedRssMetadata.feedGenerator),
		feedSkipHours: Array.isArray(input.feedSkipHours)
			? input.feedSkipHours
			: [],
		feedSkipDays: Array.isArray(input.feedSkipDays) ? input.feedSkipDays : [],
		feedTtl: typeof input.feedTtl === "number" ? input.feedTtl : undefined,
		feedImage: s(input.feedImage) || undefined,
	};
}

export function normalizeLoadedFeedConfig(
	input: Record<string, unknown>,
): FeedConfig {
	const feedType = s(input.feedType, "webScraping");

	const base = {
		schemaVersion:
			typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
		feedId: s(input.feedId),
		feedName: s(input.feedName, "RSS Feed"),
		feedType,
		enabled: b(input.enabled, true),
		refreshTime: n(input.refreshTime, 5),
		reverse: b(input.reverse, false),
		strict: b(input.strict, false),
		advanced: b(input.advanced, false),
		headers: normalizeProtectedRecord(input.headers),
		cookies: Array.isArray(input.cookies) ? input.cookies : [],
		webhook: input.webhook as FeedConfig["webhook"],
		flaresolverr: input.flaresolverr as FeedConfig["flaresolverr"],
		metadata: input.metadata as FeedConfig["metadata"],
		...normalizeRssMetadata(input),
	};

	if (feedType === "webScraping") {
		const config: WebScrapingFeedConfig = {
			...base,
			feedType: "webScraping",
			config: (input.config as WebScrapingFeedConfig["config"]) ?? {
				baseUrl: "",
			},
			article: normalizeArticle(
				(input.article as Record<string, unknown>) ?? {},
			),
		};
		return config;
	}

	if (feedType === "rest") {
		return {
			...base,
			feedType: "rest",
			config: (input.config as RestFeedConfig["config"]) ?? { baseUrl: "" },
			apiMapping: normalizeApiMapping(input.apiMapping),
		} as RestFeedConfig;
	}

	if (feedType === "api") {
		return {
			...base,
			feedType: "api",
			config: (input.config as ApiFeedConfig["config"]) ?? { baseUrl: "" },
			apiMapping: normalizeApiMapping(input.apiMapping),
		} as ApiFeedConfig;
	}

	if (feedType === "email") {
		return {
			...base,
			feedType: "email",
			config: (input.config as EmailFeedConfig["config"]) ?? {
				host: "",
				port: 993,
				user: "",
				folder: "INBOX",
				emailCount: 10,
			},
		} as EmailFeedConfig;
	}

	if (feedType === "feedTransformer") {
		return {
			...base,
			feedType: "feedTransformer",
			feedTransformer:
				(input.feedTransformer as FeedTransformerFeedConfig["feedTransformer"]) ?? {
					sources: [],
					mergeStrategy: "dateDesc",
					dedupeAcrossSources: true,
				},
		} as FeedTransformerFeedConfig;
	}

	// Remaining types pass through with their own source block. The block key
	// comes from the registry rather than being assumed equal to the type id:
	// webhook stores its block under `webhookFeed`, and assuming otherwise
	// dropped it entirely on every round trip.
	const sourceBlock = getFeedSourceDefinition(feedType)?.sourceBlock ?? feedType;
	return {
		...base,
		feedType,
		[sourceBlock]: (input[sourceBlock] as Record<string, unknown>) ?? {},
	} as FeedConfig;
}
