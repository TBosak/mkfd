// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/sitemap.utility.ts: sitemap.url is a
// URL a feed author fully controls, and fetchAndBuildSitemapItems fetches it
// with a bare `axios.get(config.url, ...)` — no call to
// assertOutboundFetchAllowed, no policy at all (see
// utilities/sitemap.utility.ts). These tests drive the real public
// `fetchAndBuildSitemapItems` entry point directly (not an internal policy
// helper) with a blocked target and prove today it is not refused.
//
// axios.get is mocked at the shared module-object level — the same
// convention tests/selector-playground-proxy-isolation.test.ts already uses
// — so a "leak" is directly observable (the function returns items built
// from content nobody should have been allowed to fetch) without making any
// real network call.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { fetchAndBuildSitemapItems } from "../utilities/sitemap.utility";
import type { SitemapFeedConfig } from "../models/sitemap.model";

const originalAxiosGet = axios.get;

afterEach(() => {
	axios.get = originalAxiosGet;
});

const BASE_CONFIG: SitemapFeedConfig = {
	inputMode: "exact",
	url: "",
	mode: "urlList",
	maxItems: 50,
	maxUrlsToScan: 50,
	sortOrder: "sitemapOrder",
	dateStrategy: "bestAvailable",
	titleStrategy: "path",
	descriptionStrategy: "none",
};

const LEAK_MARKER = "internal-sitemap-secret-9f21";
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>http://internal.example/${LEAK_MARKER}</loc></url></urlset>`;

function mockUpstreamXml(xml: string): string[] {
	const calls: string[] = [];
	axios.get = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: xml };
	}) as typeof axios.get;
	return calls;
}

describe("fetchAndBuildSitemapItems — outbound executor policy (requirement 7)", () => {
	test("sanity: an ordinary public sitemap.url is fetched and parsed", async () => {
		mockUpstreamXml(SITEMAP_XML);
		const items = await fetchAndBuildSitemapItems({ ...BASE_CONFIG, url: "http://example.com/sitemap.xml" });
		expect(items).toHaveLength(1);
		expect(items[0].link).toContain(LEAK_MARKER);
	});

	test("refuses a loopback sitemap.url through its own public entry point, without ever making the request", async () => {
		const calls = mockUpstreamXml(SITEMAP_XML);
		await expect(
			fetchAndBuildSitemapItems({ ...BASE_CONFIG, url: "http://127.0.0.1/sitemap.xml" }),
		).rejects.toThrow(/blocked|private|loopback/i);
		expect(calls).toHaveLength(0);
	});

	test("refuses a cloud metadata sitemap.url through its own public entry point", async () => {
		const calls = mockUpstreamXml(SITEMAP_XML);
		await expect(
			fetchAndBuildSitemapItems({ ...BASE_CONFIG, url: "http://metadata.google.internal/computeMetadata/v1/" }),
		).rejects.toThrow(/metadata|blocked/i);
		expect(calls).toHaveLength(0);
	});
});
