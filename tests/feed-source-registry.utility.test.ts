// TDD slice: p3-source-definition-registry
//
// Unit tests over the new source-definition registry itself (requirement 1,
// requirement 3's registration mechanism, requirement 4 and 5's declared
// metadata, and requirement 6's "unknown types are refused" primitive).
//
// ---------------------------------------------------------------------------
// Design assumption this file (and its sibling dispatch/compat files) commits
// to, per the brief's "notes and open questions for the lead":
//
//   - The registry lives at utilities/feed-source-registry.utility.ts,
//     mirroring the one existing registry precedent in this codebase
//     (utilities/service-connector-registry.utility.ts: types in models/,
//     the runtime registry object + accessors in utilities/).
//   - Handlers are functions held directly in the registry entry (the
//     brief's first option: "more direct"), not identifiers a separate
//     dispatcher maps — this repo's service-connector registry already
//     holds adapter objects with real functions on them, not string ids.
//   - changeDetection is registered honestly as `implemented: false` (a
//     stub), per the brief's explicit preference. It is also declared
//     `previewSupported: false`.
//   - Every other of the twelve FeedType union members (see
//     models/feed-config.model.ts:14-26) is `implemented: true`.
//   - `previewSupported` is true for exactly the ten types
//     generatePreview() already has a working branch for today
//     (webScraping, rest, api, feedTransformer, sitemap, calendar, graphql,
//     webhook, filesystem, serviceConnector) and false for the two it does
//     not (email, changeDetection) — see
//     tests/feed-source-registry-dispatch.test.ts for the behavioural half
//     of that claim.
//   - `protectedFields` is a declared string[] per type (paths are this
//     file's only assumption-light spot: it checks shape and non-emptiness
//     for types known to carry secrets today, not exact path strings, so it
//     does not lock the lead into one path-naming convention).
//   - A minimal registration API exists for requirement 3:
//     `registerFeedSourceType(definition)` / `unregisterFeedSourceType(type)`.
//     Without *some* mutation entry point, requirement 3 ("add a type by
//     touching one place") cannot be exercised by a test at all — the brief
//     anticipates this ("if the design cannot support that, say so").
//
// If the lead's actual module shape differs from this assumption, every
// test in this file (and its siblings) fails at import time — a `bun test`
// "Cannot find module" / "is not a function" error, not a assertion
// mismatch — which is the correct RED signal for "this production surface
// does not exist yet", and the specific names above are easy to reconcile
// with the real implementation during review.
// ---------------------------------------------------------------------------

import { describe, expect, test, afterEach } from "bun:test";
import {
	FEED_SOURCE_REGISTRY,
	getFeedSourceDefinition,
	listFeedSourceTypes,
	registerFeedSourceType,
	unregisterFeedSourceType,
	type FeedSourceDefinition,
} from "../utilities/feed-source-registry.utility";
import type { FeedType } from "../models/feed-config.model";

// The twelve canonical members of the FeedType union, transcribed verbatim
// from models/feed-config.model.ts:14-26 (a type has no runtime
// representation to import, so this is the deliberate value-level mirror —
// requirement 1's runtime half of the union/registry agreement proof).
const ALL_FEED_TYPES: readonly FeedType[] = [
	"webScraping",
	"rest",
	"api",
	"email",
	"graphql",
	"calendar",
	"sitemap",
	"filesystem",
	"webhook",
	"feedTransformer",
	"serviceConnector",
	"changeDetection",
];

const PREVIEW_SUPPORTED_TYPES = new Set<string>([
	"webScraping",
	"rest",
	"api",
	"feedTransformer",
	"sitemap",
	"calendar",
	"graphql",
	"webhook",
	"filesystem",
	"serviceConnector",
]);

const TYPES_KNOWN_TO_CARRY_SECRETS_TODAY = new Set<string>([
	"webScraping",
	"rest",
	"api",
	"email",
	"graphql",
	"serviceConnector",
]);

// ---------------------------------------------------------------------------
// requirement 1: the registry is the single source of truth for type IDs,
// and it must not be able to disagree with the FeedType union.
// ---------------------------------------------------------------------------

describe("requirement 1 — registry declares exactly the FeedType union, no more, no fewer", () => {
	test("Object.keys(FEED_SOURCE_REGISTRY) is exactly the twelve canonical feed types (order-independent)", () => {
		const registryKeys = Object.keys(FEED_SOURCE_REGISTRY).sort();
		const unionKeys = [...ALL_FEED_TYPES].sort();
		expect(registryKeys).toEqual(unionKeys);
	});

	// Compile-time half of the same claim: this only type-checks (bun run
	// typecheck / verify:static) if FEED_SOURCE_REGISTRY's key set is
	// *exactly* the FeedType union in both directions — a registry entry for
	// a type outside the union, or a union member missing from the registry,
	// is a type error here, not merely a runtime gap. `bun test` strips
	// types and will not itself fail this line if it disagrees; the
	// runtime assertion above is what `bun test` enforces directly.
	test("sanity: the compile-time Record<FeedType, ...> assignment below is present in this file (checked by bun run typecheck, not bun test)", () => {
		const _typeLevelAgreement: Record<FeedType, FeedSourceDefinition> = FEED_SOURCE_REGISTRY;
		expect(Object.keys(_typeLevelAgreement).length).toBe(ALL_FEED_TYPES.length);
	});

	test.each([...ALL_FEED_TYPES])("%s has a registry entry", (type) => {
		expect(FEED_SOURCE_REGISTRY[type]).toBeDefined();
		expect(FEED_SOURCE_REGISTRY[type].type).toBe(type);
	});
});

// ---------------------------------------------------------------------------
// requirement 1 / 4 / 5 — declared metadata shape, table-driven across all
// twelve types (requirement 7's "a regression names the type that broke"
// expectation, applied at the registry-metadata level).
// ---------------------------------------------------------------------------

describe("every registry entry declares the metadata the rest of the system needs", () => {
	test.each([...ALL_FEED_TYPES])(
		"%s declares schemaVersion (number), protectedFields (string[]), previewSupported (boolean), implemented (boolean), outputCapabilities (string[])",
		(type) => {
			const def = FEED_SOURCE_REGISTRY[type];
			expect(typeof def.schemaVersion).toBe("number");
			expect(def.schemaVersion).toBeGreaterThan(0);
			expect(Array.isArray(def.protectedFields)).toBe(true);
			for (const path of def.protectedFields) expect(typeof path).toBe("string");
			expect(typeof def.previewSupported).toBe("boolean");
			expect(typeof def.implemented).toBe("boolean");
			expect(Array.isArray(def.outputCapabilities)).toBe(true);
		},
	);

	test.each([...PREVIEW_SUPPORTED_TYPES])(
		"%s is declared previewSupported (matches generatePreview's existing working branch today)",
		(type) => {
			expect(FEED_SOURCE_REGISTRY[type as FeedType].previewSupported).toBe(true);
		},
	);

	test.each(["email", "changeDetection"])(
		"%s is declared NOT previewSupported (generatePreview has no branch for it today)",
		(type) => {
			expect(FEED_SOURCE_REGISTRY[type as FeedType].previewSupported).toBe(false);
		},
	);

	test.each([...TYPES_KNOWN_TO_CARRY_SECRETS_TODAY])(
		"%s declares at least one protected field path (it carries a secret-shaped value today: headers, password, or auth fields)",
		(type) => {
			expect(FEED_SOURCE_REGISTRY[type as FeedType].protectedFields.length).toBeGreaterThan(0);
		},
	);

	test("changeDetection is registered honestly as a stub: implemented === false (its config type is Record<string, unknown> — the brief's own signal that it is not real yet)", () => {
		expect(FEED_SOURCE_REGISTRY.changeDetection.implemented).toBe(false);
	});

	test.each(ALL_FEED_TYPES.filter((t) => t !== "changeDetection"))(
		"%s is registered as implemented (every type other than the known stub is real today)",
		(type) => {
			expect(FEED_SOURCE_REGISTRY[type].implemented).toBe(true);
		},
	);
});

// ---------------------------------------------------------------------------
// requirement 2 primitive — an unregistered type is refused, not silently
// accepted. (The behavioural dispatch proof through real entry points lives
// in tests/feed-source-registry-dispatch.test.ts and
// tests/feed-source-registry-worker-and-routes.test.ts; this is the
// registry-level building block those depend on.)
// ---------------------------------------------------------------------------

describe("requirement 2 primitive — unregistered types are refused by the registry itself", () => {
	test("getFeedSourceDefinition returns undefined for a type that was never registered", () => {
		expect(getFeedSourceDefinition("definitely-not-a-real-source-type-8f2c")).toBeUndefined();
	});

	test("listFeedSourceTypes() never includes an unregistered name", () => {
		expect(listFeedSourceTypes()).not.toContain("definitely-not-a-real-source-type-8f2c");
	});

	test("listFeedSourceTypes() includes all twelve canonical types", () => {
		const listed = new Set(listFeedSourceTypes());
		for (const type of ALL_FEED_TYPES) expect(listed.has(type)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// requirement 3 — the registry supports adding a source type by registering
// it, without any other production file needing a matching branch. This test
// only proves the registry-level mechanism (round trip); the end-to-end
// "routes through a real public entry point" proof is in
// tests/feed-source-registry-dispatch.test.ts, since that is the part the
// brief explicitly says must not be satisfied by "asserts the registry
// object has keys" alone.
// ---------------------------------------------------------------------------

describe("requirement 3 mechanism — registerFeedSourceType / unregisterFeedSourceType round trip", () => {
	const FICTITIOUS_TYPE = "__p3RegistryUnitTestFictitiousSource__";

	afterEach(() => {
		unregisterFeedSourceType(FICTITIOUS_TYPE);
	});

	test("a newly registered type is retrievable by getFeedSourceDefinition and appears in listFeedSourceTypes()", () => {
		const definition: FeedSourceDefinition = {
			type: FICTITIOUS_TYPE,
			schemaVersion: 1,
			implemented: true,
			previewSupported: true,
			protectedFields: [],
			outputCapabilities: ["rss2"],
		};
		registerFeedSourceType(definition);

		expect(getFeedSourceDefinition(FICTITIOUS_TYPE)).toEqual(definition);
		expect(listFeedSourceTypes()).toContain(FICTITIOUS_TYPE);
	});

	test("unregistering removes it again — getFeedSourceDefinition returns undefined and it drops out of listFeedSourceTypes()", () => {
		registerFeedSourceType({
			type: FICTITIOUS_TYPE,
			schemaVersion: 1,
			implemented: true,
			previewSupported: false,
			protectedFields: [],
			outputCapabilities: [],
		});
		unregisterFeedSourceType(FICTITIOUS_TYPE);

		expect(getFeedSourceDefinition(FICTITIOUS_TYPE)).toBeUndefined();
		expect(listFeedSourceTypes()).not.toContain(FICTITIOUS_TYPE);
	});

	// Anti-bypass: registering a type twice must not silently let the second
	// registration overwrite the first without the caller asking for that —
	// otherwise a typo'd re-registration (or two unrelated features
	// colliding on the same name) could silently replace a real handler with
	// nothing failing loudly, which is exactly the "silently half-works"
	// failure mode requirement 1 says must not exist for the union either.
	test("registering the same type name twice throws rather than silently overwriting the first definition", () => {
		registerFeedSourceType({
			type: FICTITIOUS_TYPE,
			schemaVersion: 1,
			implemented: true,
			previewSupported: false,
			protectedFields: [],
			outputCapabilities: [],
		});
		expect(() =>
			registerFeedSourceType({
				type: FICTITIOUS_TYPE,
				schemaVersion: 2,
				implemented: true,
				previewSupported: false,
				protectedFields: [],
				outputCapabilities: [],
			}),
		).toThrow();
	});

	test("registering a type name that collides with one of the twelve canonical types throws (cannot silently replace webScraping's real handler)", () => {
		expect(() =>
			registerFeedSourceType({
				type: "webScraping",
				schemaVersion: 999,
				implemented: true,
				previewSupported: false,
				protectedFields: [],
				outputCapabilities: [],
			}),
		).toThrow();
		// And the real entry must be provably untouched by the attempt.
		expect(FEED_SOURCE_REGISTRY.webScraping.schemaVersion).not.toBe(999);
	});
});

// ---------------------------------------------------------------------------
// requirement 6 primitive — validateFeedConfig's existing supportedFeedTypes
// set (utilities/feed-config-validator.utility.ts:39-42) must not be
// weakened, and should agree with the registry's own type set. This is a
// structural cross-check, not a call into the validator (which is out of
// scope for this slice beyond "do not weaken it").
// ---------------------------------------------------------------------------

describe("registry key set agrees with feed-config-validator.utility.ts's supportedFeedTypes set (both must name the same twelve types)", () => {
	test("every registry key is one of the validator's currently-supported feed types", async () => {
		const { validateFeedConfig } = await import("../utilities/feed-config-validator.utility");
		for (const type of ALL_FEED_TYPES) {
			const result = validateFeedConfig({
				feedId: "x",
				feedName: "X",
				feedType: type,
				refreshTime: 5,
			} as never);
			const unsupportedTypeError = result.errors.find((e) => e.path === "feedType");
			expect(
				unsupportedTypeError,
				`registry declares '${type}' but the validator rejects it as unsupported: ${JSON.stringify(unsupportedTypeError)}`,
			).toBeUndefined();
		}
	});
});
