// TDD slice: p3-source-definition-registry
//
// requirement 4 — preview support is declared, not inferred. `email` and
// `changeDetection` have no working branch in generatePreview() today
// (utilities/preview-generator.utility.ts): they fall off the end of the
// if/else chain and hit the same generic
// `throw new Error("Feed could not be generated for preview.")` that any
// other silent failure would also produce. That message names neither the
// type nor says preview specifically isn't supported for it — exactly the
// "falling off the end" behaviour the brief calls out. Post-slice, a
// registry-declared `previewSupported: false` must produce a clear,
// type-specific refusal instead.
//
// requirement 2 sanity — a type declared previewSupported (webScraping)
// must be unaffected: it still attempts real generation.
//
// Deliberately has NO dependency on the new registry module, unlike
// tests/feed-source-registry-dispatch.test.ts — every test here drives only
// the real, already-existing generatePreview() entry point, so it can be
// run and verified against current behaviour right now instead of only
// ever failing at import time.
//
// Loopback-only Bun.serve fixtures, same convention as
// tests/preview-generator-outbound-executor.test.ts.

import { afterEach, describe, expect, test } from "bun:test";
import { generatePreview } from "../utilities/preview-generator.utility";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

function startServer(hostname: string, fetchHandler: (req: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname, port: 0, fetch: fetchHandler });
	cleanups.push(() => server.stop(true));
	return { url: `http://${hostname}:${server.port}`, port: server.port };
}

describe("requirement 4 — preview support is declared: unsupported types are refused with a specific message naming the type", () => {
	test("generatePreview() refuses 'email' with a message that names the type and mentions preview, not the generic catch-all", async () => {
		let caught: unknown;
		try {
			await generatePreview({
				feedType: "email",
				feedId: "preview-support-email",
				feedName: "Preview Support Email",
				config: { host: "imap.example.com", port: 993, user: "u", folder: "INBOX", emailCount: 5 },
			});
		} catch (error) {
			caught = error;
		}
		expect(caught, "generatePreview() must refuse email preview, not silently succeed").toBeInstanceOf(Error);
		const message = (caught as Error).message;
		expect(message, `message was: ${message}`).toMatch(/email/i);
		expect(message, `message was: ${message}`).toMatch(/preview/i);
	});

	test("generatePreview() refuses 'changeDetection' with a message that names the type and mentions preview, not the generic catch-all", async () => {
		let caught: unknown;
		try {
			await generatePreview({
				feedType: "changeDetection",
				feedId: "preview-support-change-detection",
				feedName: "Preview Support Change Detection",
				changeDetection: {},
			});
		} catch (error) {
			caught = error;
		}
		expect(caught, "generatePreview() must refuse changeDetection preview, not silently succeed").toBeInstanceOf(Error);
		const message = (caught as Error).message;
		expect(message, `message was: ${message}`).toMatch(/changeDetection/i);
		expect(message, `message was: ${message}`).toMatch(/preview/i);
	});
});

describe("requirement 2 sanity — a type declared previewSupported is unaffected by requirement 4's refusal path", () => {
	test("webScraping still attempts real generation rather than being refused up front", async () => {
		const hop1 = startServer("127.0.0.1", () =>
			new Response("<html><body><article><h1>Requirement 4 sanity item</h1></article></body></html>", {
				headers: { "content-type": "text/html" },
			}),
		);

		const feed = await generatePreview({
			feedType: "webScraping",
			feedId: "preview-support-webscraping-sanity",
			feedName: "Preview Support WebScraping Sanity",
			allowlist: ["127.0.0.1"],
			config: { baseUrl: `${hop1.url}/page` },
			article: { iterator: { selector: "article" }, title: { selector: "h1" } },
		});

		expect(feed.rss2()).toContain("Requirement 4 sanity item");
	});
});

describe("requirement 2 — two different registered types dispatch to genuinely different handlers through the same generatePreview() call site", () => {
	const originalAllowlistEnv = process.env.OUTBOUND_FETCH_ALLOWLIST;

	afterEach(() => {
		process.env.OUTBOUND_FETCH_ALLOWLIST = originalAllowlistEnv;
	});

	test("a sitemap config and a webScraping config produce feeds with the shape only their own source type can produce", async () => {
		// fetchAndBuildSitemapItems (utilities/sitemap.utility.ts) always uses
		// the *global* policy (getGlobalFetchPolicyOptions()), unlike
		// webScraping's fetchWebScrapingHtml which honors a per-feed
		// `allowlist` override — so the sitemap hop needs the env-based
		// allowlist, not a feedConfig field.
		process.env.OUTBOUND_FETCH_ALLOWLIST = "127.0.0.1";

		const sitemapServer = startServer("127.0.0.1", () =>
			new Response(
				`<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>http://127.0.0.1/requirement-2-sitemap-marker</loc></url></urlset>`,
				{ headers: { "content-type": "application/xml" } },
			),
		);
		const scrapeServer = startServer("127.0.0.1", () =>
			new Response(
				"<html><body><article><h1>requirement-2-webscraping-marker</h1></article></body></html>",
				{ headers: { "content-type": "text/html" } },
			),
		);

		const sitemapFeed = await generatePreview({
			feedType: "sitemap",
			feedId: "requirement-2-sitemap",
			feedName: "Requirement 2 Sitemap",
			sitemap: {
				inputMode: "exact",
				url: `${sitemapServer.url}/sitemap.xml`,
				mode: "urlList",
				maxItems: 10,
				maxUrlsToScan: 10,
				sortOrder: "sitemapOrder",
				dateStrategy: "bestAvailable",
				titleStrategy: "path",
				descriptionStrategy: "none",
			},
		});

		const scrapeFeed = await generatePreview({
			feedType: "webScraping",
			feedId: "requirement-2-webscraping",
			feedName: "Requirement 2 WebScraping",
			allowlist: ["127.0.0.1"],
			config: { baseUrl: `${scrapeServer.url}/page` },
			article: { iterator: { selector: "article" }, title: { selector: "h1" } },
		});

		expect(sitemapFeed.rss2()).toContain("requirement-2-sitemap-marker");
		expect(sitemapFeed.rss2()).not.toContain("requirement-2-webscraping-marker");
		expect(scrapeFeed.rss2()).toContain("requirement-2-webscraping-marker");
		expect(scrapeFeed.rss2()).not.toContain("requirement-2-sitemap-marker");
	});
});
