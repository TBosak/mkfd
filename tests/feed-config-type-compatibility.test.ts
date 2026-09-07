// TDD slice: p3-source-definition-registry
//
// requirement 7 — every existing source type keeps working: "twelve types,
// each with a real config, must still cast, normalize, validate ... exactly
// as before. The slice reorganises where knowledge lives; it changes no
// behaviour." Table-driven across all twelve FeedType union members (see
// models/feed-config.model.ts:14-26), so a regression names the type that
// broke.
//
// Deliberately has NO dependency on the new registry module: this file
// drives only real, already-existing production entry points
// (castFeedFormDataToFeedConfig, normalizeLoadedFeedConfig,
// validateFeedConfig, real yaml.dump/yaml.load round trips through the
// same disk format routes/feeds.ts actually writes), so every assertion
// here can be run and verified against current behaviour right now. Two
// types deliberately do not follow the same "form -> cast -> yaml -> load
// -> normalize -> validate" path as the other ten, each for a documented,
// verified reason:
//
//   - "api": castFeedFormDataToFeedConfig unconditionally aliases a form
//     submission of feedType "api" to "rest" (utilities/feed-config-
//     caster.utility.ts:94-95) — there is no way to *create* a persisted
//     "api" config through the supported form path today. But
//     normalizeLoadedFeedConfig still has a dedicated branch for it
//     (utilities/feed-config-normalizer.utility.ts:129-136), and
//     workers/feed-updater.worker.ts and preview-generator.utility.ts both
//     still dispatch `api` alongside `rest`. This is exactly a legacy /
//     hand-authored-YAML compatibility case: an existing on-disk config
//     with feedType "api" (predating the rest alias, or written by hand)
//     must still normalize, validate, and dispatch correctly, even though
//     the form can no longer produce one. Tested via normalize+validate on
//     a hand-built raw config, not via the caster.
//   - "changeDetection": castFeedFormDataToFeedConfig has no branch for it
//     and throws "unsupported feedType" (verified directly — see
//     tests/feed-source-registry-worker-and-routes.test.ts's create/update/
//     preview refusal tests) — consistent with the brief's own framing of
//     it as an honest, registered-but-unimplemented stub. Tested via
//     normalize+validate only, not cast.
//
// A third type, "webhook", DOES follow the full round trip below, and its
// test is written to assert the *correct* outcome (the round trip
// preserves the persisted webhookFeed block) rather than today's actual
// outcome — because running it against the current code (see this file's
// change history / the revision report) surfaces a genuine, independently
// verified pre-existing defect in utilities/feed-config-normalizer.utility
// .ts, one of this slice's own owned files: its generic "stub types and
// unknown" fallback branch (lines 165-170) writes the loaded block back
// under the key `[feedType]` — literally the string "webhook" — but the
// WebhookFeedConfig model (models/feed-config.model.ts:188) names that
// field `webhookFeed`, a completely different key already used for
// something else (`OutgoingWebhookConfig`, feed-config.model.ts:60-68,
// 88). A feed created through the real POST / route (which produces
// `webhookFeed` correctly via the caster) silently loses its entire
// webhookFeed block — slug, tokenHash, retentionDays, everything — the
// moment it is loaded back from its saved YAML, and the worker then
// crashes attempting to read it (independently reproduced through the real
// worker thread in tests/feed-source-registry-worker-and-routes.test.ts's
// filesystem sanity check's earlier webhook attempt, before this file's
// author switched that specific sanity check to filesystem to avoid
// conflating this defect with that file's own, unrelated requirement-6
// proof). This is squarely requirement 7's concern ("normalize ... exactly
// as before" — except it does not currently work at all), so it is
// asserted here as the real desired behaviour rather than routed around.

import { describe, expect, test } from "bun:test";
import * as yaml from "js-yaml";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";
import { normalizeLoadedFeedConfig } from "../utilities/feed-config-normalizer.utility";
import { validateFeedConfig } from "../utilities/feed-config-validator.utility";
import type { FeedType } from "../models/feed-config.model";

const ENCRYPTION_KEY = "p3-source-definition-registry-test-key-32chars";

function roundTrip(formInput: Record<string, unknown>, feedId: string) {
	const cast = castFeedFormDataToFeedConfig(formInput, { feedId, encryptionKey: ENCRYPTION_KEY });
	const dumped = yaml.dump(cast);
	const loaded = yaml.load(dumped) as Record<string, unknown>;
	const normalized = normalizeLoadedFeedConfig(loaded);
	const validation = validateFeedConfig(normalized);
	return { cast, normalized, validation };
}

// ---------------------------------------------------------------------------
// The ten types that go through the ordinary form -> cast -> yaml -> load ->
// normalize -> validate path unchanged.
// ---------------------------------------------------------------------------

const ORDINARY_ROUND_TRIP_CASES: Array<{
	type: FeedType;
	formInput: Record<string, unknown>;
	assertSurvives: (normalized: Record<string, unknown>) => void;
}> = [
	{
		type: "webScraping",
		formInput: { feedType: "webScraping", feedName: "Compat WebScraping", refreshTime: 5, feedUrl: "https://example.com/articles", itemSelector: "article" },
		assertSurvives: (n) => expect((n as unknown as { config: { baseUrl: string } }).config.baseUrl).toBe("https://example.com/articles"),
	},
	{
		type: "rest",
		formInput: { feedType: "rest", feedName: "Compat Rest", refreshTime: 5, feedUrl: "https://api.example.com", apiRoute: "/items" },
		assertSurvives: (n) => expect((n as unknown as { config: { baseUrl: string } }).config.baseUrl).toBe("https://api.example.com"),
	},
	{
		type: "email",
		formInput: {
			feedType: "email",
			feedName: "Compat Email",
			refreshTime: 5,
			emailHost: "imap.example.com",
			emailUsername: "user@example.com",
			emailFolder: "INBOX",
			emailCount: 10,
			emailPassword: "compat-email-secret",
		},
		assertSurvives: (n) => expect((n as unknown as { config: { host: string } }).config.host).toBe("imap.example.com"),
	},
	{
		type: "graphql",
		formInput: {
			feedType: "graphql",
			feedName: "Compat GraphQL",
			refreshTime: 5,
			graphqlEndpoint: "https://api.example.com/graphql",
			graphqlQuery: "{ posts { id } }",
		},
		assertSurvives: (n) =>
			expect((n as unknown as { graphql: { endpoint: string } }).graphql.endpoint).toBe("https://api.example.com/graphql"),
	},
	{
		type: "calendar",
		formInput: { feedType: "calendar", feedName: "Compat Calendar", refreshTime: 5, calendarUrl: "https://example.com/calendar.ics" },
		assertSurvives: (n) => expect((n as unknown as { calendar: { url: string } }).calendar.url).toBe("https://example.com/calendar.ics"),
	},
	{
		type: "sitemap",
		formInput: { feedType: "sitemap", feedName: "Compat Sitemap", refreshTime: 5, sitemapUrl: "https://example.com/sitemap.xml" },
		assertSurvives: (n) => expect((n as unknown as { sitemap: { url: string } }).sitemap.url).toBe("https://example.com/sitemap.xml"),
	},
	{
		type: "filesystem",
		formInput: { feedType: "filesystem", feedName: "Compat Filesystem", refreshTime: 5, filesystemRootPath: "/srv/feeds/compat" },
		assertSurvives: (n) => expect((n as unknown as { filesystem: { rootPath: string } }).filesystem.rootPath).toBe("/srv/feeds/compat"),
	},
	{
		type: "feedTransformer",
		formInput: {
			feedType: "feedTransformer",
			feedName: "Compat FeedTransformer",
			refreshTime: 5,
			transformerSources: [{ url: "https://example.com/upstream.xml", format: "auto" }],
		},
		assertSurvives: (n) =>
			expect((n as unknown as { feedTransformer: { sources: Array<{ url: string }> } }).feedTransformer.sources[0].url).toBe(
				"https://example.com/upstream.xml",
			),
	},
	{
		type: "serviceConnector",
		formInput: {
			feedType: "serviceConnector",
			feedName: "Compat ServiceConnector",
			refreshTime: 5,
			serviceConnectorService: "jellyfin",
			serviceConnectorServerUrl: "https://jellyfin.example.com",
			serviceConnectorResourceId: "movies",
			serviceConnectorApiKey: "compat-service-connector-secret",
		},
		assertSurvives: (n) =>
			expect(
				(n as unknown as { serviceConnector: { connection: { settings: { serverUrl: string } } } }).serviceConnector.connection.settings
					.serverUrl,
			).toBe("https://jellyfin.example.com"),
	},
];

describe("requirement 7 — cast -> yaml round trip -> normalize -> validate, table-driven across every ordinary source type", () => {
	for (const { type, formInput, assertSurvives } of ORDINARY_ROUND_TRIP_CASES) {
		test(`${type}: casts, round-trips through YAML, normalizes, and validates as a working config`, () => {
			const feedId = `compat-${type}`;
			const { cast, normalized, validation } = roundTrip(formInput, feedId);

			expect(cast.feedType, `cast produced the wrong feedType for ${type}`).toBe(type);
			expect(normalized.feedType, `normalize produced the wrong feedType for ${type} after a YAML round trip`).toBe(type);
			assertSurvives(normalized as unknown as Record<string, unknown>);
			expect(
				validation.valid,
				`${type} failed validation after normalizing: ${JSON.stringify(validation.errors)}`,
			).toBe(true);
		});
	}
});

// ---------------------------------------------------------------------------
// "webhook" — same round trip, but asserting the *correct* outcome. See the
// file header for the verified pre-existing defect this currently exposes.
// ---------------------------------------------------------------------------

describe("requirement 7 — webhook: the persisted webhookFeed block must survive a save/load round trip", () => {
	test("a webhook feed's webhookFeed.slug and tokenHash survive cast -> yaml -> normalize (RED: today they are silently dropped)", () => {
		const feedId = "compat-webhook";
		const cast = castFeedFormDataToFeedConfig(
			{ feedType: "webhook", feedName: "Compat Webhook", refreshTime: 5 },
			{ feedId, encryptionKey: ENCRYPTION_KEY },
		);
		const castWebhookFeed = (cast as unknown as { webhookFeed?: { slug?: string; tokenHash?: string } }).webhookFeed;
		expect(castWebhookFeed?.slug, "sanity: cast itself must produce a webhookFeed block").toBeTruthy();

		const dumped = yaml.dump(cast);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const normalizedWebhookFeed = (normalized as unknown as { webhookFeed?: { slug?: string; tokenHash?: string } }).webhookFeed;

		expect(
			normalizedWebhookFeed?.slug,
			`normalizeLoadedFeedConfig must preserve webhookFeed.slug across a save/load round trip; got webhookFeed=${JSON.stringify(normalizedWebhookFeed)}`,
		).toBe(castWebhookFeed.slug);
		expect(
			normalizedWebhookFeed?.tokenHash,
			"normalizeLoadedFeedConfig must preserve webhookFeed.tokenHash across a save/load round trip",
		).toBe(castWebhookFeed.tokenHash);

		const validation = validateFeedConfig(normalized);
		expect(
			validation.valid,
			`webhook feed failed validation after the round trip: ${JSON.stringify(validation.errors)}`,
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// "api" — legacy/hand-authored-config compatibility: the caster can no
// longer produce this feedType (it aliases to "rest"), but an existing
// on-disk config carrying it must still normalize, validate, and be
// dispatchable — normalizeLoadedFeedConfig and the validator both still
// treat it as its own first-class type.
// ---------------------------------------------------------------------------

describe("requirement 7 — api: an existing (pre-alias, hand-authored, or legacy) on-disk config still normalizes and validates", () => {
	test("sanity: castFeedFormDataToFeedConfig aliases a form submission of feedType 'api' to 'rest', so 'api' cannot be produced through the supported create/update path (documents why this type is tested differently below)", () => {
		const cast = castFeedFormDataToFeedConfig(
			{ feedType: "api", feedName: "Compat Api Alias Sanity", refreshTime: 5, feedUrl: "https://api.example.com" },
			{ feedId: "compat-api-alias-sanity", encryptionKey: ENCRYPTION_KEY },
		);
		expect(cast.feedType).toBe("rest");
	});

	test("a hand-built raw config with feedType 'api' (as an existing YAML file on disk would have) normalizes to feedType 'api' and validates", () => {
		const raw = {
			feedId: "compat-api-legacy",
			feedName: "Compat Api Legacy",
			feedType: "api",
			refreshTime: 5,
			config: { baseUrl: "https://api.example.com", route: "/items", method: "GET" },
			apiMapping: { items: "data.items", title: "title" },
		};
		const dumped = yaml.dump(raw);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const validation = validateFeedConfig(normalized);

		expect(normalized.feedType).toBe("api");
		expect((normalized as unknown as { config: { baseUrl: string } }).config.baseUrl).toBe("https://api.example.com");
		expect(validation.valid, `legacy 'api' config failed validation: ${JSON.stringify(validation.errors)}`).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// "changeDetection" — the honest stub. castFeedFormDataToFeedConfig
// deliberately has no branch for it (verified directly in
// tests/feed-source-registry-worker-and-routes.test.ts's create/update/
// preview refusal tests). It is still a member of the FeedType union and
// the validator's supportedFeedTypes set, so an already-existing (or
// manually placed) YAML config carrying it must normalize and pass the
// validator's structural checks — the validator has no changeDetection-
// specific field rules today, only the shared feedType-membership check.
// ---------------------------------------------------------------------------

describe("requirement 7 — changeDetection: normalizes and passes the validator's structural checks (cast is intentionally unsupported — it is an honest stub)", () => {
	test("a hand-built raw config with feedType 'changeDetection' normalizes to feedType 'changeDetection' and passes the validator's structural (non-per-type) checks", () => {
		const raw = {
			feedId: "compat-changedetection",
			feedName: "Compat ChangeDetection",
			feedType: "changeDetection",
			refreshTime: 5,
			changeDetection: {},
		};
		const dumped = yaml.dump(raw);
		const loaded = yaml.load(dumped) as Record<string, unknown>;
		const normalized = normalizeLoadedFeedConfig(loaded);
		const validation = validateFeedConfig(normalized);

		expect(normalized.feedType).toBe("changeDetection");
		expect(
			validation.errors.find((e) => e.path === "feedType"),
			`changeDetection must not be rejected as an unsupported feedType by the validator's shared membership check: ${JSON.stringify(validation.errors)}`,
		).toBeUndefined();
	});
});
