// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/selector-suggestion.utility.ts.
// suggestSelectors's non-FlareSolverr path calls its own local
// axiosGetWithPolicyRedirects helper, which validates every *redirect*
// target via assertOutboundFetchAllowed but never validates the initial
// URL itself before the first request (see
// utilities/selector-suggestion.utility.ts: the hop loop starts with
// `axios.get(currentUrl, ...)` before any policy check). These tests drive
// the real public suggestSelectors entry point with a blocked target and
// prove the very first (non-redirect) request is not currently refused.
//
// axios.get is mocked at the shared module-object level (no live network
// call). The mocked page has enough repeating structure that, absent the
// missing SSRF check, suggestSelectors succeeds normally — isolating the
// missing-policy defect from unrelated selector-inference behavior.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { suggestSelectors } from "../utilities/selector-suggestion.utility";

const originalAxiosGet = axios.get;

afterEach(() => {
	axios.get = originalAxiosGet;
});

const REPEATING_ARTICLE_HTML = `
<html><body>
${[1, 2, 3, 4]
	.map(
		(n) => `
<article>
  <h2><a href="/item-${n}">Item title number ${n}</a></h2>
  <p>A sufficiently long description paragraph for item ${n} so that description coverage heuristics pass.</p>
</article>`,
	)
	.join("\n")}
</body></html>`;

function mockUpstreamHtml(html: string): string[] {
	const calls: string[] = [];
	axios.get = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: html };
	}) as typeof axios.get;
	return calls;
}

describe("suggestSelectors — outbound executor policy (requirement 7)", () => {
	test("sanity: an ordinary public target url is fetched and produces selectors", async () => {
		mockUpstreamHtml(REPEATING_ARTICLE_HTML);
		const result = await suggestSelectors("http://example.com/list");
		expect(result.iterator.length).toBeGreaterThan(0);
	});

	test("refuses a loopback target url through its own public entry point, without ever making the initial (hop-zero) request", async () => {
		const calls = mockUpstreamHtml(REPEATING_ARTICLE_HTML);
		await expect(suggestSelectors("http://127.0.0.1/list")).rejects.toThrow(/blocked|private|loopback/i);
		expect(calls).toHaveLength(0);
	});

	test("refuses a cloud metadata target url through its own public entry point", async () => {
		const calls = mockUpstreamHtml(REPEATING_ARTICLE_HTML);
		await expect(
			suggestSelectors("http://metadata.google.internal/computeMetadata/v1/"),
		).rejects.toThrow(/metadata|blocked/i);
		expect(calls).toHaveLength(0);
	});
});
