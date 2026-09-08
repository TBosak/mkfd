// TDD slice: p3-browser-adapter
//
// utilities/preview-generator.utility.ts:92 is the preview-explicit browser
// call site the brief names for migration to lib/outbound/browser-adapter.ts.
//
// generatePreview already runs a top-level `assertOutboundFetchAllowed`
// check against `feedConfig.config.baseUrl` before any type-specific logic
// (see the file's own `previewUrl` check) -- so a blocked *starting* URL is
// already refused today, pre-migration, and re-proving that would not
// demonstrate anything new. What that top-level, one-shot string check
// cannot catch is exactly what this slice adds: subresources the scraped
// page pulls in, and redirects the browser follows after that one check
// already passed. Those are what these tests target, plus the budget/
// behaviour-preservation requirements.
//
// No real Chromium process is launched -- see tests/helpers/fake-browser.ts's
// doc comment for why this file mocks the "patchright" module rather than
// using the `_launchBrowser` injection tests/browser-adapter.test.ts uses.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { BrowserHarness, mockPatchright } from "./helpers/fake-browser";

const harness = new BrowserHarness();
mockPatchright(harness);

import { generatePreview } from "../utilities/preview-generator.utility";

afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	harness.reset();
});

const BASE_URL = "http://93.184.216.34";
const PRIVATE_SUB = "http://10.0.0.5/admin";
const PRIVATE_REDIRECT_TARGET = "http://10.0.0.5/redirected";
const MARKER = "preview-generator-browser-marker-4d1c";
const HTML = `<html><body><article><h2 class="title">${MARKER}</h2><a class="link" href="/1">Link</a></article></body></html>`;

function webScrapingConfig(overrides: Record<string, unknown> = {}) {
	return {
		feedId: "preview-browser-test",
		feedName: "Preview Browser Test",
		feedType: "webScraping",
		refreshTime: 5,
		advanced: true,
		config: { baseUrl: BASE_URL },
		article: {
			iterator: { selector: "article" },
			title: { selector: ".title" },
			link: {
				selector: ".link",
				attribute: "href",
				isRelative: true,
				baseUrl: BASE_URL,
			},
		},
		...overrides,
	};
}

describe("generatePreview — browser adapter (requirements 1, 2, 5, migration)", () => {
	test("sanity: advanced (browser) preview navigates through the adapter and builds the feed from its content", async () => {
		harness.htmlByUrl.set(BASE_URL, HTML);

		const feed = await generatePreview(webScrapingConfig());

		expect(feed.rss2()).toContain(MARKER);
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([BASE_URL]);
	});

	test("a private-address subresource pulled in by the scraped page is aborted (not caught by the one-shot baseUrl pre-check)", async () => {
		harness.htmlByUrl.set(BASE_URL, HTML);
		harness.subresourcesByUrl.set(BASE_URL, [PRIVATE_SUB]);

		const feed = await generatePreview(webScrapingConfig());

		expect(feed.rss2()).toContain(MARKER); // the document itself still renders
		expect(harness.routeVerdicts).toContainEqual({
			url: PRIVATE_SUB,
			action: "abort",
			isNavigation: false,
		});
	});

	test("a redirect from the permitted baseUrl to a private address is refused at the hop (not caught by the one-shot baseUrl pre-check)", async () => {
		harness.redirectChains.set(BASE_URL, [BASE_URL, PRIVATE_REDIRECT_TARGET]);

		await expect(generatePreview(webScrapingConfig())).rejects.toThrow();
	});

	test("the launch timeout is derived from the feed's own fetchPolicy.feedRunTimeoutMs, not the old hardcoded 60s/10s defaults", async () => {
		harness.htmlByUrl.set(BASE_URL, HTML);

		await generatePreview(
			webScrapingConfig({ fetchPolicy: { feedRunTimeoutMs: 1500 } }),
		);

		expect(harness.launchOptionsCalls.length).toBe(1);
		const timeout = harness.launchOptionsCalls[0].timeout;
		expect(typeof timeout).toBe("number");
		expect(timeout as number).toBeLessThanOrEqual(1500);
	});

	test("applies configured headers and cookies (hostname-derived domain) to the browser session", async () => {
		harness.htmlByUrl.set(BASE_URL, HTML);

		await generatePreview(
			webScrapingConfig({
				headers: { "X-Test": "abc" },
				cookies: [{ name: "session", value: "preview-cookie-secret" }],
			}),
		);

		expect(harness.contexts[0]?.pages[0]?.extraHeaders).toEqual({
			"X-Test": "abc",
		});
		expect(harness.contexts[0]?.cookiesAdded).toContainEqual({
			name: "session",
			value: "preview-cookie-secret",
			domain: "93.184.216.34",
			path: "/",
		});
	});

	test("an unrelated navigation error is not silently swallowed as if it were the tolerable networkidle timeout, and the browser still closes (requirement 6)", async () => {
		harness.gotoThrows.set(BASE_URL, new Error("ECONNRESET"));

		await expect(generatePreview(webScrapingConfig())).rejects.toThrow();
		expect(harness.browserCloseCount).toBe(1);
	});
});
