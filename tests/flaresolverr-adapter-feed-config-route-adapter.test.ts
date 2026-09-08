// TDD slice: p3-flaresolverr-adapter
//
// utilities/feed-config-route-adapter.utility.ts:154 (fetchSampleHtml) is
// one of the four call sites the brief's table marks as already validating
// the FlareSolverr endpoint before posting to it. These tests are the
// v2-compatibility half of requirement 7 for the sample-HTML-fetching flow
// (used by the feed builder's "fetch sample" step), plus requirement 3
// (endpoint and target validated separately) and requirement 1 (the direct
// axios.post itself must be gone, proved by
// tests/flaresolverr-adapter-static-guard.test.ts).

import { afterEach, describe, expect, test } from "bun:test";
import { fetchSampleHtml } from "../utilities/feed-config-route-adapter.utility";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

function startFlareSolverrStub(handler: (payload: Record<string, unknown>) => { response?: string; solutionStatus?: number }) {
	let requests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (req) => {
			requests++;
			const payload = (await req.json()) as Record<string, unknown>;
			const result = handler(payload);
			return Response.json({
				solution: { status: result.solutionStatus ?? 200, response: result.response ?? "" },
			});
		},
	});
	cleanups.push(() => server.stop(true));
	return { url: `http://127.0.0.1:${server.port}`, requestCount: () => requests };
}

const MARKER = "sample-html-flaresolverr-marker-a247";
const HTML = `<html><body>${MARKER}</body></html>`;
const PERMITTED_TARGET = "http://93.184.216.34/sample";
const BLOCKED_TARGET = "http://10.0.0.5/sample";

describe("fetchSampleHtml — FlareSolverr adapter (requirements 1, 3, 7)", () => {
	test("sanity: a permitted endpoint fetches sample HTML through FlareSolverr", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML }));

		const html = await fetchSampleHtml({
			feedUrl: PERMITTED_TARGET,
			body: { flaresolverr: { enabled: true, serverUrl: stub.url, timeout: "5000" } },
			policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
		});

		expect(html).toContain(MARKER);
		expect(stub.requestCount()).toBe(1);
	});

	test("refuses a blocked (non-allowlisted loopback) FlareSolverr endpoint, without ever contacting it", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML }));

		let caught: unknown;
		try {
			await fetchSampleHtml({
				feedUrl: PERMITTED_TARGET,
				body: { flaresolverr: { enabled: true, serverUrl: stub.url, timeout: "5000" } },
				policyOptions: { allowlist: [], allowPrivateFetches: false },
			});
		} catch (error) {
			caught = error;
		}

		expect(caught, "a blocked FlareSolverr endpoint must be refused").toBeDefined();
		expect(stub.requestCount()).toBe(0);
	});

	test("refuses a blocked target even though the endpoint is permitted, without ever contacting the endpoint (requirement 3)", async () => {
		const stub = startFlareSolverrStub(() => ({ response: HTML }));

		let caught: unknown;
		try {
			await fetchSampleHtml({
				feedUrl: BLOCKED_TARGET,
				body: { flaresolverr: { enabled: true, serverUrl: stub.url, timeout: "5000" } },
				policyOptions: { allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			});
		} catch (error) {
			caught = error;
		}

		expect(caught, "a blocked sample-fetch target must be refused").toBeDefined();
		expect(
			stub.requestCount(),
			"the permitted endpoint must never be contacted when the target fails its own, separate validation",
		).toBe(0);
	});
});
