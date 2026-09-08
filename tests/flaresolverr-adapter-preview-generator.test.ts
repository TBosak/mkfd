// TDD slice: p3-flaresolverr-adapter
//
// utilities/preview-generator.utility.ts:90 is one of the four call sites
// the brief's table marks as already validating the FlareSolverr endpoint
// (assertOutboundFetchAllowed on `${flaresolverrUrl}/v1` at line 75) before
// posting to it. These tests are primarily the v2-compatibility half of the
// brief's requirement 7 — proving generatePreview's explicit-preview flow
// keeps working once the direct axios.post is replaced by the shared
// adapter — plus requirement 3 (separate target validation), which today's
// code does not perform for the FlareSolverr branch specifically (the
// top-level `previewUrl` check at line 59 validates `feedConfig.config.baseUrl`
// once, but that is the *page* URL for other feed types; for webScraping it
// is the same baseUrl FlareSolverr is told to fetch, so this file's
// "blocked target" case exercises whether that shared check is still
// reached — and requirement 1, that the direct axios.post itself is gone).

import { afterEach, describe, expect, test } from "bun:test";
import { generatePreview } from "../utilities/preview-generator.utility";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

interface StubResult {
	response?: string;
	solutionStatus?: number;
	message?: string;
}

function startFlareSolverrStub(handler: (payload: Record<string, unknown>) => StubResult) {
	let requests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (req) => {
			requests++;
			const payload = (await req.json()) as Record<string, unknown>;
			const result = handler(payload);
			return Response.json({
				message: result.message ?? "",
				solution: {
					status: result.solutionStatus ?? 200,
					response: result.response ?? "",
				},
			});
		},
	});
	cleanups.push(() => server.stop(true));
	return {
		url: `http://127.0.0.1:${server.port}`,
		requestCount: () => requests,
	};
}

const MARKER = "preview-generator-flaresolverr-marker-6b18";
const HTML = `<html><body><article><h2 class="title">${MARKER}</h2><a class="link" href="/1">Link</a></article></body></html>`;

function webScrapingConfig(overrides: Record<string, unknown> = {}) {
	return {
		feedId: "preview-flaresolverr-test",
		feedName: "Preview FlareSolverr Test",
		feedType: "webScraping",
		refreshTime: 5,
		config: { baseUrl: "http://93.184.216.34" },
		article: {
			iterator: { selector: "article" },
			title: { selector: ".title" },
			link: { selector: ".link", attribute: "href", isRelative: true, baseUrl: "http://93.184.216.34" },
		},
		...overrides,
	};
}

describe("generatePreview — FlareSolverr adapter (requirements 1, 3, 7)", () => {
	test("sanity: an explicit preview with a permitted endpoint fetches through FlareSolverr", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML, solutionStatus: 200 }));

		const feed = await generatePreview(
			webScrapingConfig({
				allowlist: ["127.0.0.1"],
				flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
			}),
		);

		expect(feed.rss2()).toContain(MARKER);
		expect(stub.requestCount()).toBe(1);
	});

	test("refuses a blocked (non-allowlisted loopback) FlareSolverr endpoint, without ever contacting it", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML }));

		let caught: unknown;
		let feed: import("feed").Feed | undefined;
		try {
			feed = await generatePreview(
				webScrapingConfig({
					flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
				}),
			);
		} catch (error) {
			caught = error;
		}

		if (feed) {
			expect(feed.rss2()).not.toContain(MARKER);
		}
		expect(stub.requestCount() === 0 || caught !== undefined).toBe(true);
		expect(stub.requestCount()).toBe(0);
	});

	test("refuses a blocked target (config.baseUrl) even though the FlareSolverr endpoint is permitted, without ever contacting the endpoint (requirement 3)", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML }));

		let caught: unknown;
		try {
			await generatePreview(
				webScrapingConfig({
					config: { baseUrl: "http://10.0.0.5" },
					allowlist: ["127.0.0.1"],
					flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
				}),
			);
		} catch (error) {
			caught = error;
		}

		expect(caught, "a blocked preview target must be refused").toBeDefined();
		expect(
			stub.requestCount(),
			"the permitted FlareSolverr endpoint must never be contacted when the preview target fails its own, separate validation",
		).toBe(0);
	});
});
