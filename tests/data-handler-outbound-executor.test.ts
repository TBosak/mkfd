// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/data-handler.utility.ts:
// resolveDrillChain's non-advanced, non-FlareSolverr branch fetches a
// feed-author-controlled URL (the drill chain's starting URL, or a relative
// link discovered mid-chain) with a bare `axios.get`, and no outbound
// policy check at all (see utilities/data-handler.utility.ts). These tests
// drive the real public resolveDrillChain entry point with a blocked URL
// and prove today it is not refused.
//
// resolveDrillChain deliberately swallows fetch failures and returns "" —
// that is existing, intentional behavior for ordinary network errors (see
// its catch blocks), not something this slice should change. So "refused"
// here is proven the same way the function already reports any other
// fetch failure: the result is "" and, crucially, does NOT contain content
// that could only have come from actually reaching the blocked server —
// proving the request was never made, not just that some later step
// happened to fail.
//
// axios.get is mocked at the shared module-object level (no live network
// call), the same convention already used across this repo's other
// outbound-policy tests.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { resolveDrillChain } from "../utilities/data-handler.utility";

const originalAxiosGet = axios.get;

afterEach(() => {
	axios.get = originalAxiosGet;
});

const LEAK_MARKER = "internal-drillchain-secret-77ac";
const HTML = `<html><body><a id="target" href="/${LEAK_MARKER}">link</a></body></html>`;

const CHAIN = [
	{ selector: "#target", attribute: "href", isRelative: false, baseUrl: "", stripHtml: false },
];

function mockUpstreamHtml(html: string): string[] {
	const calls: string[] = [];
	axios.get = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: html };
	}) as typeof axios.get;
	return calls;
}

describe("resolveDrillChain — outbound executor policy (requirement 7)", () => {
	test("sanity: an ordinary public starting URL is fetched and drilled", async () => {
		mockUpstreamHtml(HTML);
		const result = await resolveDrillChain("http://example.com/page", CHAIN);
		expect(result).toContain(LEAK_MARKER);
	});

	test("refuses a loopback starting URL through its own public entry point, without ever making the request", async () => {
		const calls = mockUpstreamHtml(HTML);
		const result = await resolveDrillChain("http://127.0.0.1/page", CHAIN);
		expect(result).not.toContain(LEAK_MARKER);
		expect(calls).toHaveLength(0);
	});

	test("refuses a cloud metadata starting URL through its own public entry point", async () => {
		const calls = mockUpstreamHtml(HTML);
		const result = await resolveDrillChain(
			"http://metadata.google.internal/computeMetadata/v1/",
			CHAIN,
		);
		expect(result).not.toContain(LEAK_MARKER);
		expect(calls).toHaveLength(0);
	});
});
