// TDD slice: p3-source-definition-registry
//
// requirement 3 — adding a source type requires touching one place. Proven
// end to end: registering a fictitious type through the new registry
// module, and only through it, must be enough for generatePreview() (a
// real, unmodified-by-this-test production entry point) to route to it.
//
// This is the one requirement in this slice that cannot be tested without
// importing the not-yet-existing registry module (utilities/feed-source-
// registry.utility.ts) — see tests/feed-source-registry.utility.test.ts for
// the assumed API shape and the reasoning behind it. Every test below fails
// at import time ("Cannot find module") until that module exists; that is
// the correct RED signal for "the mechanism this requirement needs does not
// exist yet", not a fixture mistake.
//
// requirement 4 (preview support declared) and the requirement 2 sanity
// check for generatePreview() live in
// tests/feed-source-registry-preview-support.test.ts instead, deliberately
// separated into a file with no dependency on the registry module, so they
// can be run and verified against generatePreview()'s current behaviour
// right now rather than only ever failing at import time.

import { afterEach, describe, expect, test } from "bun:test";
import { generatePreview } from "../utilities/preview-generator.utility";
import {
	registerFeedSourceType,
	unregisterFeedSourceType,
	type FeedSourceDefinition,
} from "../utilities/feed-source-registry.utility";
import { buildFeedFromNormalizedItems } from "../utilities/normalized-feed-builder.utility";

describe("requirement 3 — a fictitious source type registered only through the registry routes end to end through generatePreview()", () => {
	const FICTITIOUS_TYPE = "__p3DispatchTestFictitiousSource__";
	const MARKER = "fictitious-source-marker-6b1e9a";

	afterEach(() => {
		unregisterFeedSourceType(FICTITIOUS_TYPE);
	});

	test("before registration, generatePreview() refuses the fictitious type (it is genuinely unknown, not a hidden default fallback)", async () => {
		await expect(
			generatePreview({
				feedType: FICTITIOUS_TYPE,
				feedId: "fictitious-before-register",
				feedName: "Fictitious Before Register",
			}),
		).rejects.toThrow();
	});

	test("after registering it via registerFeedSourceType, generatePreview() dispatches to its handler and returns the handler's own content — with zero other production files touched by this test", async () => {
		const definition: FeedSourceDefinition = {
			type: FICTITIOUS_TYPE,
			schemaVersion: 1,
			implemented: true,
			previewSupported: true,
			protectedFields: [],
			outputCapabilities: ["rss2"],
			executePreview: async (feedConfig: { feedId: string; feedName: string }) =>
				buildFeedFromNormalizedItems({
					feedId: feedConfig.feedId,
					feedName: feedConfig.feedName,
					items: [{ title: MARKER, link: "https://example.com/fictitious" }],
				}),
		};
		registerFeedSourceType(definition);

		const feed = await generatePreview({
			feedType: FICTITIOUS_TYPE,
			feedId: "fictitious-after-register",
			feedName: "Fictitious After Register",
		});

		expect(feed.rss2()).toContain(MARKER);
	});

	test("after unregistering it again, generatePreview() refuses it once more (the routing was genuinely driven by the registry entry, not cached or hardcoded elsewhere)", async () => {
		registerFeedSourceType({
			type: FICTITIOUS_TYPE,
			schemaVersion: 1,
			implemented: true,
			previewSupported: true,
			protectedFields: [],
			outputCapabilities: ["rss2"],
			executePreview: async (feedConfig: { feedId: string; feedName: string }) =>
				buildFeedFromNormalizedItems({
					feedId: feedConfig.feedId,
					feedName: feedConfig.feedName,
					items: [{ title: MARKER }],
				}),
		});
		unregisterFeedSourceType(FICTITIOUS_TYPE);

		await expect(
			generatePreview({
				feedType: FICTITIOUS_TYPE,
				feedId: "fictitious-after-unregister",
				feedName: "Fictitious After Unregister",
			}),
		).rejects.toThrow();
	});
});
