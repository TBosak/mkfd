// TDD slice: p3-v2-golden-round-trips
//
// Contract tests for the roadmap's V2-01/02/04/06/10/13/14/16 golden round
// trips (Packet 3): "editing and saving a feed destroys data that the
// runtime still supports." Each `describe` block below is named after the
// finding it proves, and drives the real `castFeedFormDataToFeedConfig` and
// `normalizeLoadedFeedConfig` entry points through an actual `yaml.dump` /
// `yaml.load` cycle (mirroring `feed-config-type-compatibility.test.ts`), so
// a fixture that only exercised in-memory objects and skipped serialization
// would miss exactly the losses that happen there.
//
// Two findings from the brief were verified and are NOT tested below as
// backend defects — see the accompanying report for the evidence:
//
//   - V2-14, as originally framed ("the rich cookie model ... is reduced to
//     v2 {name,value} strings"), does not reproduce in the caster or
//     normalizer: a cookie's domain/path/secure/httpOnly and a cookie's
//     ProtectedValue *shape* all pass through `castFeedFormDataToFeedConfig`
//     and a full YAML round trip unchanged today (proven by the passing
//     regression-lock tests in this file's "V2-14" section). What *is*
//     broken, verified directly, is that a brand-new `{ type: "protected" }`
//     cookie value is never run through `protectValue`/`encrypt` the way a
//     header or an API param is — its plaintext is written straight to the
//     on-disk YAML. That is a secret-leak defect, not a shape defect, and is
//     what this file's "V2-14" tests actually prove RED.
//   - V2-16 ("API feeds lost the cookie input entirely") does not reproduce
//     in the backend either: `castFeedFormDataToFeedConfig`'s shared `base`
//     object assigns `cookies` identically for every feed type, `rest`
//     included, and a full round trip preserves them (also proven by a
//     regression-lock test below). The gap is that
//     `frontend/src/components/forms/APIForm.tsx` has no cookie input at
//     all — a frontend omission, out of this slice's owned surfaces
//     (explicitly Packet 5's `configToFormData`/builder-forms half).
//
// Assumptions this file makes, called out for the lead to confirm or
// correct (see the brief's own open questions):
//
//   - New per-field CSSTarget form inputs follow the existing
//     `${prefix}${PascalCasePropertyName}` convention that every other
//     `buildCSSTargetFromForm` field already uses (`${prefix}Selector`,
//     `${prefix}StripHtml`, ...). Applied to the two missing
//     `CSSTargetOptions` properties this gives `${prefix}DrillChain` and
//     `${prefix}Iterator`; applied to `guidIsPermaLink` it gives
//     `${prefix}GuidIsPermaLink` (a double "guid" for the `guid` field
//     itself, e.g. `guidGuidIsPermaLink` — mechanically consistent, if
//     awkward to read). Because `buildCSSTargetFromForm` today reads none of
//     these keys under any name, the exact spelling does not change whether
//     these tests are RED; it only documents the contract the fix should
//     satisfy.
//   - The two wholly new `ApiMapping` fields named in the brief,
//     `guidIsPermaLink` (already declared on `models/api-mapping.model.ts`
//     but never populated by the caster) and `feedLinkPath` /
//     `feedLastBuildDatePath` (not declared anywhere in the codebase today),
//     are read from form inputs `apiGuidIsPermaLink`, `apiFeedLinkPath` and
//     `apiFeedLastBuildDatePath`, following the existing `api${Field}`
//     convention (`apiFeedPubDate` -> `feedPubDate`, `apiGuid` -> `guid`).
//     `feedLinkPath` and `feedLastBuildDatePath` need a model addition in
//     `models/api-mapping.model.ts` (not `models/feed-config.model.ts`,
//     which the brief's ownership note names but which does not hold
//     `ApiMapping`).
//   - `feedDocs` and `feedGenerator` (and the rest of the V2-06 metadata)
//     need NO new model field: `FeedRssMetadata` on
//     `models/feed-config.model.ts` already declares every one of them.
//     The defect is entirely that `castFeedFormDataToFeedConfig` spreads
//     `defaultFeedRssMetadata` and then only ever overrides `feedLanguage`
//     and `feedDescription` from `data`, silently resetting every other
//     field to its default on every save. Confirmed by reading
//     `utilities/feed-config-caster.utility.ts:131-134` and by running the
//     cast function directly.
//   - The canonical, non-legacy wire shape for both headers and REST/API
//     feed-level metadata paths is the one `utilities/rss-builder.utility.ts`
//     already reads at runtime (a plain `Record<string, string |
//     ProtectedValue>` for headers; unsuffixed keys — `feedTitle`, not
//     `feedTitlePath` — for API mapping feed-level paths). That file is the
//     only real consumer and was read directly to confirm this, since the
//     model and the frontend converter disagree with each other and with the
//     runtime today.

import { describe, expect, test } from "bun:test";
import * as yaml from "js-yaml";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import { isProtectedValue, resolveProtectedValue } from "../utilities/protected-values.utility";
import type { WebScrapingFeedConfig, RestFeedConfig, WebhookFeedConfig } from "../models/feed-config.model";
import type { FeedCookie, ProtectedValue } from "../models/protected-value.model";

const ENCRYPTION_KEY = "p3-v2-golden-round-trips-test-key-32-chars-long";

function roundTrip(formInput: Record<string, unknown>, feedId: string) {
	const cast = castFeedFormDataToFeedConfig(formInput, { feedId, encryptionKey: ENCRYPTION_KEY });
	const dumped = yaml.dump(cast);
	const loaded = yaml.load(dumped) as Record<string, unknown>;
	const normalized = normalizeLoadedFeedConfig(loaded);
	return { cast, normalized };
}

function baseWebScrapingInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		feedType: "webScraping",
		feedName: "Golden Round Trip",
		refreshTime: 5,
		feedUrl: "https://example.com/articles",
		itemSelector: "article",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// V2-13 — `enabled` is preserved, not asserted, in both directions.
// ---------------------------------------------------------------------------

describe("V2-13 — enabled survives an edit round trip in both directions", () => {
	test("a feed saved with enabled=false stays disabled after cast -> yaml -> normalize", () => {
		const { cast, normalized } = roundTrip(baseWebScrapingInput({ enabled: false }), "v2-13-disabled");
		expect(cast.enabled, "castFeedFormDataToFeedConfig must not force enabled to true").toBe(false);
		expect(normalized.enabled, "a disabled feed must still be disabled after a save/load round trip").toBe(false);
	});

	test("a feed saved with enabled=true stays enabled after cast -> yaml -> normalize", () => {
		const { cast, normalized } = roundTrip(baseWebScrapingInput({ enabled: true }), "v2-13-enabled");
		expect(cast.enabled).toBe(true);
		expect(normalized.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// V2-04 — the outgoing webhook block keeps headers and customPayload.
// ---------------------------------------------------------------------------

describe("V2-04 — outgoing webhook headers and customPayload survive an edit round trip", () => {
	function webhookInput(webhook: Record<string, unknown>) {
		return baseWebScrapingInput({ webhook });
	}

	test("webhook.headers (plain string values) survive", () => {
		const { normalized } = roundTrip(
			webhookInput({
				enabled: true,
				url: "https://hooks.example.com/notify",
				format: "json",
				newItemsOnly: false,
				headers: { "X-Signing-Secret": "shared-secret-value" },
			}),
			"v2-04-headers",
		);
		const webhook = (normalized as unknown as { webhook?: WebhookFeedConfig["webhook"] }).webhook as
			| { headers?: Record<string, unknown> }
			| undefined;
		expect(webhook, "webhook block must survive the round trip at all").toBeDefined();
		expect(
			webhook?.headers?.["X-Signing-Secret"],
			`webhook.headers was dropped; got webhook=${JSON.stringify(webhook)}`,
		).toBe("shared-secret-value");
	});

	test("webhook.headers (a protected value) is encrypted, not stored as plaintext", () => {
		const { cast } = roundTrip(
			webhookInput({
				enabled: true,
				url: "https://hooks.example.com/notify",
				format: "json",
				newItemsOnly: false,
				headers: { Authorization: { type: "protected", value: "webhook-bearer-token" } },
			}),
			"v2-04-protected-headers",
		);
		const webhook = (cast as unknown as { webhook?: { headers?: Record<string, unknown> } }).webhook;
		const authHeader = webhook?.headers?.Authorization;
		expect(authHeader, "webhook.headers.Authorization was dropped entirely").toBeDefined();
		expect(isProtectedValue(authHeader), "a protected webhook header must stay a ProtectedValue").toBe(true);
		if (isProtectedValue(authHeader)) {
			expect(authHeader.value, "a protected webhook header must be encrypted, not left as plaintext").not.toBe(
				"webhook-bearer-token",
			);
		}
	});

	test("webhook.customPayload survives", () => {
		const { normalized } = roundTrip(
			webhookInput({
				enabled: true,
				url: "https://hooks.example.com/notify",
				format: "json",
				newItemsOnly: false,
				customPayload: '{"title": "{{title}}", "link": "{{link}}"}',
			}),
			"v2-04-custom-payload",
		);
		const webhook = (normalized as unknown as { webhook?: { customPayload?: string } }).webhook;
		expect(webhook?.customPayload, `webhook.customPayload was dropped; got webhook=${JSON.stringify(webhook)}`).toBe(
			'{"title": "{{title}}", "link": "{{link}}"}',
		);
	});
});

// ---------------------------------------------------------------------------
// V2-01 — CSSTarget fields survive whole: drillChain, the per-field nested
// iterator, and GUID permalink state, across more than one article field.
// ---------------------------------------------------------------------------

describe("V2-01 — CSSTarget properties survive whole across every article field", () => {
	const DRILL_CHAIN = [{ selector: "a.detail-link", attribute: "href", isRelative: true, baseUrl: "https://example.com" }];

	const FIELDS_WITH_DRILL_CHAIN: Array<{ prefix: string; articlePath: keyof WebScrapingFeedConfig["article"] }> = [
		{ prefix: "title", articlePath: "title" },
		{ prefix: "guid", articlePath: "guid" },
		{ prefix: "categories", articlePath: "categories" },
	];

	for (const { prefix, articlePath } of FIELDS_WITH_DRILL_CHAIN) {
		test(`article.${articlePath}.drillChain survives (not just the first configured field)`, () => {
			const { normalized } = roundTrip(
				baseWebScrapingInput({
					[`${prefix}Selector`]: ".value",
					[`${prefix}DrillChain`]: DRILL_CHAIN,
				}),
				`v2-01-drillchain-${articlePath}`,
			) as unknown as { normalized: WebScrapingFeedConfig };
			const target = normalized.article[articlePath] as { drillChain?: unknown } | undefined;
			expect(
				target?.drillChain,
				`article.${articlePath}.drillChain was dropped; got ${JSON.stringify(target)}`,
			).toEqual(DRILL_CHAIN);
		});
	}

	test("article.iterator (the item container) also keeps its own drillChain", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ itemDrillChain: DRILL_CHAIN }),
			"v2-01-drillchain-item-iterator",
		) as unknown as { normalized: WebScrapingFeedConfig };
		expect(
			(normalized.article.iterator as unknown as { drillChain?: unknown }).drillChain,
			"the article iterator's own drillChain was dropped",
		).toEqual(DRILL_CHAIN);
	});

	test("article.guid.guidIsPermaLink survives as true", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ guidSelector: "a", guidAttribute: "href", guidGuidIsPermaLink: true }),
			"v2-01-guid-permalink-true",
		) as unknown as { normalized: WebScrapingFeedConfig };
		expect(
			(normalized.article.guid as unknown as { guidIsPermaLink?: boolean } | undefined)?.guidIsPermaLink,
			"article.guid.guidIsPermaLink was dropped",
		).toBe(true);
	});

	test("article.guid.guidIsPermaLink survives as false (not just truthy defaulting)", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ guidSelector: "a", guidAttribute: "href", guidGuidIsPermaLink: false }),
			"v2-01-guid-permalink-false",
		) as unknown as { normalized: WebScrapingFeedConfig };
		expect(
			(normalized.article.guid as unknown as { guidIsPermaLink?: boolean } | undefined)?.guidIsPermaLink,
		).toBe(false);
	});

	test("a per-field nested iterator (parallel iteration within one CSSTarget) survives", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ categoriesSelector: ".tag", categoriesIterator: ".tag-list" }),
			"v2-01-nested-iterator",
		) as unknown as { normalized: WebScrapingFeedConfig };
		expect(
			(normalized.article.categories as unknown as { iterator?: string } | undefined)?.iterator,
			"the per-field nested iterator was dropped",
		).toBe(".tag-list");
	});
});

// ---------------------------------------------------------------------------
// V2-02 — common headers keep their shape, including the legacy
// [{key,value}] array migrating losslessly to the canonical record.
// ---------------------------------------------------------------------------

describe("V2-02 — common headers survive an edit round trip, including legacy-array migration", () => {
	test("a header submitted in the legacy [{key,value}] array shape keeps its name and value", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ headers: [{ key: "Authorization", value: "Bearer plain-token" }] }),
			"v2-02-legacy-array-headers",
		);
		const headers = normalized.headers as Record<string, unknown> | undefined;
		expect(
			headers?.Authorization,
			`legacy [{key,value}] headers must migrate to a canonical record; got headers=${JSON.stringify(headers)}`,
		).toBe("Bearer plain-token");
		expect(headers?.["0"], "the array index must never become a header name").toBeUndefined();
	});

	test("a protected header submitted in the legacy [{key,value}] array shape stays a ProtectedValue and gets encrypted", () => {
		const { cast } = roundTrip(
			baseWebScrapingInput({
				headers: [{ key: "X-Api-Key", value: { type: "protected", value: "legacy-array-secret" } }],
			}),
			"v2-02-legacy-array-protected-header",
		);
		const apiKeyHeader = (cast.headers as Record<string, unknown> | undefined)?.["X-Api-Key"];
		expect(apiKeyHeader, "the legacy-array protected header was dropped entirely").toBeDefined();
		expect(isProtectedValue(apiKeyHeader), "it must still be a ProtectedValue, not a flattened plain string").toBe(
			true,
		);
		if (isProtectedValue(apiKeyHeader)) {
			expect(apiKeyHeader.value, "it must be encrypted, not left as plaintext").not.toBe("legacy-array-secret");
		}
	});

	test("an on-disk config whose headers were already saved in the legacy [{key,value}] array shape still resolves on load", () => {
		const raw = {
			feedId: "v2-02-legacy-on-disk",
			feedName: "Legacy On Disk",
			feedType: "webScraping",
			refreshTime: 5,
			config: { baseUrl: "https://example.com" },
			article: { iterator: { selector: "article" } },
			headers: [{ key: "Authorization", value: "Bearer already-on-disk" }],
		};
		const dumped = yaml.dump(raw);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const headers = normalized.headers as Record<string, unknown> | undefined;
		expect(
			headers?.Authorization,
			`the normalizer must migrate legacy on-disk array headers, not just reject them; got headers=${JSON.stringify(headers)}`,
		).toBe("Bearer already-on-disk");
	});

	test("regression lock: a header already in the canonical record shape still survives (this must stay green)", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ headers: { "X-Canonical": "already-fine" } }),
			"v2-02-canonical-headers-regression",
		);
		expect((normalized.headers as Record<string, unknown> | undefined)?.["X-Canonical"]).toBe("already-fine");
	});
});

// ---------------------------------------------------------------------------
// V2-06 — feed-level RSS metadata is preserved on edit instead of being reset
// to defaultFeedRssMetadata.
// ---------------------------------------------------------------------------

describe("V2-06 — feed-level RSS metadata survives an edit round trip instead of resetting to defaults", () => {
	type MetadataCase = { field: string; value: unknown };

	const METADATA_CASES: MetadataCase[] = [
		{ field: "feedCopyright", value: "© 2026 Example Corp" },
		{ field: "feedManagingEditor", value: "editor@example.com (Jane Editor)" },
		{ field: "feedWebMaster", value: "webmaster@example.com (Web Master)" },
		{ field: "feedPubDate", value: "2026-01-01T00:00:00.000Z" },
		{ field: "feedLastBuildDate", value: "2026-01-02T00:00:00.000Z" },
		{ field: "feedCategories", value: ["Technology", "News"] },
		{ field: "feedDocs", value: "https://example.com/rss-docs" },
		{ field: "feedGenerator", value: "Custom Generator 1.0" },
		{ field: "feedTtl", value: 120 },
		{ field: "feedSkipHours", value: [0, 1, 2] },
		{ field: "feedSkipDays", value: ["Saturday", "Sunday"] },
		{ field: "feedImage", value: "https://example.com/logo.png" },
	];

	for (const { field, value } of METADATA_CASES) {
		test(`${field} survives an edit round trip instead of resetting to its default`, () => {
			const { normalized } = roundTrip(baseWebScrapingInput({ [field]: value }), `v2-06-${field}`);
			expect(
				(normalized as unknown as Record<string, unknown>)[field],
				`${field} was reset to its default instead of keeping the submitted value`,
			).toEqual(value);
		});
	}

	test("regression lock: feedLanguage still survives (this must stay green)", () => {
		const { normalized } = roundTrip(baseWebScrapingInput({ feedLanguage: "fr" }), "v2-06-feedLanguage-regression");
		expect(normalized.feedLanguage).toBe("fr");
	});

	test("regression lock: feedDescription still survives (this must stay green)", () => {
		const { normalized } = roundTrip(
			baseWebScrapingInput({ feedDescription: "Custom feed description" }),
			"v2-06-feedDescription-regression",
		);
		expect(normalized.feedDescription).toBe("Custom feed description");
	});
});

// ---------------------------------------------------------------------------
// V2-10 — REST/API mapping keeps guidIsPermaLink, feedLinkPath and
// feedLastBuildDatePath, and writes the canonical (unsuffixed) feed-level
// path keys that utilities/rss-builder.utility.ts actually reads instead of
// the legacy "*Path"-suffixed ones.
// ---------------------------------------------------------------------------

function baseRestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		feedType: "rest",
		feedName: "Golden Round Trip API",
		refreshTime: 5,
		feedUrl: "https://api.example.com",
		apiItemsPath: "data.items",
		...overrides,
	};
}

describe("V2-10 — REST/API mapping keeps guidIsPermaLink, feedLinkPath and feedLastBuildDatePath", () => {
	test("apiMapping.guidIsPermaLink survives", () => {
		const { normalized } = roundTrip(baseRestInput({ apiGuid: "id", apiGuidIsPermaLink: true }), "v2-10-guid-permalink");
		const mapping = (normalized as unknown as RestFeedConfig).apiMapping as unknown as { guidIsPermaLink?: boolean };
		expect(mapping.guidIsPermaLink, "apiMapping.guidIsPermaLink was dropped").toBe(true);
	});

	test("apiMapping.feedLinkPath survives", () => {
		const { normalized } = roundTrip(baseRestInput({ apiFeedLinkPath: "data.links.self" }), "v2-10-feed-link-path");
		const mapping = (normalized as unknown as RestFeedConfig).apiMapping as unknown as { feedLinkPath?: string };
		expect(mapping.feedLinkPath, "apiMapping.feedLinkPath was dropped").toBe("data.links.self");
	});

	test("apiMapping.feedLastBuildDatePath survives", () => {
		const { normalized } = roundTrip(
			baseRestInput({ apiFeedLastBuildDatePath: "data.updatedAt" }),
			"v2-10-feed-last-build-date-path",
		);
		const mapping = (normalized as unknown as RestFeedConfig).apiMapping as unknown as {
			feedLastBuildDatePath?: string;
		};
		expect(mapping.feedLastBuildDatePath, "apiMapping.feedLastBuildDatePath was dropped").toBe("data.updatedAt");
	});

	const CANONICAL_FEED_LEVEL_PATHS: Array<{ formKey: string; canonicalKey: string; value: string | number }> = [
		{ formKey: "apiFeedTitle", canonicalKey: "feedTitle", value: "data.title" },
		{ formKey: "apiFeedDescription", canonicalKey: "feedDescription", value: "data.description" },
		{ formKey: "apiFeedLanguage", canonicalKey: "feedLanguage", value: "data.lang" },
		{ formKey: "apiFeedCopyright", canonicalKey: "feedCopyright", value: "data.rights" },
		{ formKey: "apiFeedManagingEditor", canonicalKey: "feedManagingEditor", value: "data.editor" },
		{ formKey: "apiFeedWebMaster", canonicalKey: "feedWebMaster", value: "data.webmaster" },
		{ formKey: "apiFeedPubDate", canonicalKey: "feedPubDate", value: "data.publishedAt" },
		{ formKey: "apiFeedTtl", canonicalKey: "feedTtl", value: "data.ttl" },
		{ formKey: "apiFeedSkipHours", canonicalKey: "feedSkipHours", value: "data.skipHours" },
		{ formKey: "apiFeedSkipDays", canonicalKey: "feedSkipDays", value: "data.skipDays" },
		{ formKey: "apiFeedCategories", canonicalKey: "feedCategories", value: "data.categories" },
	];

	for (const { formKey, canonicalKey, value } of CANONICAL_FEED_LEVEL_PATHS) {
		test(`apiMapping.${canonicalKey} is written under its canonical key, not a legacy "*Path" suffix`, () => {
			const { cast } = roundTrip(baseRestInput({ [formKey]: value }), `v2-10-canonical-${canonicalKey}`);
			const mapping = (cast as unknown as RestFeedConfig).apiMapping as unknown as Record<string, unknown>;
			expect(
				mapping[canonicalKey],
				`apiMapping.${canonicalKey} must hold the submitted path (rss-builder.utility.ts reads this exact key); got apiMapping=${JSON.stringify(mapping)}`,
			).toBe(value);
			expect(
				mapping[`${canonicalKey}Path`],
				`a fresh save must not also write the legacy "${canonicalKey}Path" key`,
			).toBeUndefined();
		});
	}

	test("a legacy on-disk config using the old '*Path'-suffixed apiMapping keys still resolves under the canonical key", () => {
		const raw = {
			feedId: "v2-10-legacy-on-disk",
			feedName: "Legacy API On Disk",
			feedType: "rest",
			refreshTime: 5,
			config: { baseUrl: "https://api.example.com" },
			apiMapping: { items: "data.items", feedTitlePath: "data.title", feedTtlPath: "data.ttl" },
		};
		const dumped = yaml.dump(raw);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const mapping = (normalized as unknown as RestFeedConfig).apiMapping as unknown as Record<string, unknown>;
		expect(
			mapping.feedTitle,
			`a legacy on-disk config must still resolve under the canonical key the runtime reads; got apiMapping=${JSON.stringify(mapping)}`,
		).toBe("data.title");
		expect(mapping.feedTtl, "feedTtlPath must resolve to feedTtl on load").toBe("data.ttl");
	});
});

// ---------------------------------------------------------------------------
// V2-14 — a newly submitted protected cookie value is encrypted, not written
// to disk as plaintext. (See the file header for why this replaces the
// brief's "shape" framing, and for the passing regression-lock coverage of
// cookie shape that already works today.)
// ---------------------------------------------------------------------------

describe("V2-14 — a protected cookie value is encrypted before it reaches disk", () => {
	test("a brand-new protected cookie value is not stored as plaintext", () => {
		const cookies: FeedCookie[] = [
			{ name: "session", value: { type: "protected", value: "top-secret-cookie" } as ProtectedValue, domain: "example.com", path: "/", secure: true, httpOnly: true },
		];
		const { cast } = roundTrip(baseWebScrapingInput({ cookies }), "v2-14-protected-cookie");
		const castCookies = cast.cookies as FeedCookie[] | undefined;
		const sessionCookie = castCookies?.find((c) => c.name === "session");
		expect(sessionCookie, "the session cookie was dropped entirely").toBeDefined();
		const cookieValue = sessionCookie?.value;
		expect(isProtectedValue(cookieValue), "a protected cookie value must stay a ProtectedValue").toBe(true);
		if (isProtectedValue(cookieValue)) {
			expect(
				(cookieValue as ProtectedValue & { type: "protected" }).value,
				"a protected cookie value must be encrypted before it is written to disk, not stored as plaintext",
			).not.toBe("top-secret-cookie");
		}
	});

	test("a stored protected cookie value decrypts back to the original plaintext", () => {
		const cookies: FeedCookie[] = [{ name: "session", value: { type: "protected", value: "round-trip-secret" } as ProtectedValue }];
		const { normalized } = roundTrip(baseWebScrapingInput({ cookies }), "v2-14-protected-cookie-decrypts");
		const normalizedCookies = normalized.cookies as FeedCookie[] | undefined;
		const sessionCookie = normalizedCookies?.find((c) => c.name === "session");
		const value = sessionCookie?.value;
		expect(isProtectedValue(value)).toBe(true);
		if (isProtectedValue(value)) {
			expect(resolveProtectedValue(value, ENCRYPTION_KEY)).toBe("round-trip-secret");
		}
	});

	test("regression lock: rich cookie fields (domain, path, secure, httpOnly) already survive (this must stay green)", () => {
		const cookies: FeedCookie[] = [
			{ name: "session", value: "plain-value", domain: "example.com", path: "/app", secure: true, httpOnly: true },
		];
		const { normalized } = roundTrip(baseWebScrapingInput({ cookies }), "v2-14-rich-cookie-regression");
		const sessionCookie = (normalized.cookies as FeedCookie[] | undefined)?.find((c) => c.name === "session");
		expect(sessionCookie).toEqual({
			name: "session",
			value: "plain-value",
			domain: "example.com",
			path: "/app",
			secure: true,
			httpOnly: true,
		});
	});

	test("regression lock: an env-backed cookie value keeps its variable name (this must stay green)", () => {
		const cookies: FeedCookie[] = [{ name: "session", value: { type: "env", value: "SESSION_COOKIE_VALUE" } }];
		const { normalized } = roundTrip(baseWebScrapingInput({ cookies }), "v2-14-env-cookie-regression");
		const sessionCookie = (normalized.cookies as FeedCookie[] | undefined)?.find((c) => c.name === "session");
		const cookieValue = sessionCookie?.value;
		expect(isProtectedValue(cookieValue)).toBe(true);
		if (isProtectedValue(cookieValue)) {
			expect((cookieValue as ProtectedValue & { type: "env" }).value).toBe("SESSION_COOKIE_VALUE");
		}
	});

	test("regression lock: an on-disk legacy {name,value}-only cookie still resolves (this must stay green)", () => {
		const raw = {
			feedId: "v2-14-legacy-cookie-on-disk",
			feedName: "Legacy Cookie On Disk",
			feedType: "webScraping",
			refreshTime: 5,
			config: { baseUrl: "https://example.com" },
			article: { iterator: { selector: "article" } },
			cookies: [{ name: "session", value: "legacy-plain-value" }],
		};
		const dumped = yaml.dump(raw);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const sessionCookie = (normalized.cookies as FeedCookie[] | undefined)?.find((c) => c.name === "session");
		expect(sessionCookie?.value).toBe("legacy-plain-value");
	});
});

// ---------------------------------------------------------------------------
// V2-16 — regression lock only (see the file header): the backend already
// preserves cookies for rest/api feeds; the reported loss is a frontend
// omission outside this slice's owned surfaces.
// ---------------------------------------------------------------------------

describe("V2-16 — regression lock: REST/API feeds already keep cookies through the backend round trip", () => {
	test("a rest feed's cookies survive cast -> yaml -> normalize (this must stay green; the reported gap is frontend-only, see file header)", () => {
		const cookies: FeedCookie[] = [{ name: "session", value: "api-cookie-value" }];
		const { normalized } = roundTrip(baseRestInput({ cookies }), "v2-16-rest-cookies-regression");
		const sessionCookie = (normalized.cookies as FeedCookie[] | undefined)?.find((c) => c.name === "session");
		expect(sessionCookie?.value).toBe("api-cookie-value");
	});
});

// ---------------------------------------------------------------------------
// Requirement 6 — strict per-type validation rejects a block belonging to
// another source type, naming the offending field rather than silently
// persisting it.
// ---------------------------------------------------------------------------

describe("requirement 6 — the validator refuses a config carrying another type's block", () => {
	test("a webScraping config carrying a serviceConnector block is refused, naming serviceConnector", () => {
		const normalized = normalizeLoadedFeedConfig({
			feedId: "v6-foreign-block-webscraping",
			feedName: "Foreign Block",
			feedType: "webScraping",
			refreshTime: 5,
			config: { baseUrl: "https://example.com" },
			article: { iterator: { selector: "article" } },
		}) as unknown as WebScrapingFeedConfig;
		const withForeignBlock = {
			...normalized,
			serviceConnector: {
				service: "jellyfin",
				connection: { settings: { serverUrl: "https://jellyfin.example.com" }, auth: { mode: "none", fields: {} } },
				resource: { type: "library", id: "movies" },
				preset: "latestItems",
				options: { limit: 50 },
				cursor: { strategy: "latestTimestamp", field: "DateCreated" },
			},
		};
		const result = validateFeedConfig(withForeignBlock);
		expect(result.valid, "a webScraping config carrying a serviceConnector block must be refused, not silently persisted").toBe(
			false,
		);
		expect(
			result.errors.some((e) => e.path.startsWith("serviceConnector")),
			`the refusal must name the offending field; got errors=${JSON.stringify(result.errors)}`,
		).toBe(true);
	});

	test("a rest config carrying a webhookFeed block is refused, naming webhookFeed", () => {
		const normalized = normalizeLoadedFeedConfig({
			feedId: "v6-foreign-block-rest",
			feedName: "Foreign Block",
			feedType: "rest",
			refreshTime: 5,
			config: { baseUrl: "https://api.example.com" },
			apiMapping: { items: "data" },
		}) as unknown as RestFeedConfig;
		const withForeignBlock = {
			...normalized,
			webhookFeed: {
				slug: "foreign-slug",
				tokenHash: "foreign-token-hash",
				maxItems: 50,
				retentionDays: 30,
				duplicateStrategy: "idOrHash",
				dateStrategy: "payloadDateOrReceivedAt",
				storeRawPayload: false,
				mapping: { mode: "native" },
			},
		};
		const result = validateFeedConfig(withForeignBlock);
		expect(result.valid, "a rest config carrying a webhookFeed block must be refused, not silently persisted").toBe(
			false,
		);
		expect(
			result.errors.some((e) => e.path.startsWith("webhookFeed")),
			`the refusal must name the offending field; got errors=${JSON.stringify(result.errors)}`,
		).toBe(true);
	});

	test("regression lock: the validator still rejects an unsupported feedType (this must stay green)", () => {
		const config = normalizeLoadedFeedConfig({
			feedId: "v6-unknown-type",
			feedName: "Unknown",
			feedType: "notAKnownType",
			refreshTime: 5,
		});
		const result = validateFeedConfig(config);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "feedType")).toBe(true);
	});

	test("regression lock: a config with no foreign blocks still validates (this must stay green)", () => {
		const normalized = normalizeLoadedFeedConfig({
			feedId: "v6-no-foreign-block",
			feedName: "Clean",
			feedType: "webScraping",
			refreshTime: 5,
			config: { baseUrl: "https://example.com" },
			article: { iterator: { selector: "article" } },
		});
		const result = validateFeedConfig(normalized);
		expect(result.valid, `expected no errors, got ${JSON.stringify(result.errors)}`).toBe(true);
	});
});
