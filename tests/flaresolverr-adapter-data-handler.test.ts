// TDD slice: p3-flaresolverr-adapter
//
// utilities/data-handler.utility.ts's resolveDrillChain owns two of the
// three currently-unvalidated FlareSolverr call sites the brief identifies:
// the initial-URL fetch (line 216) and the mid-drill-chain-step fetch (line
// 362). Both share one `flaresolverr` argument, but are reached by different
// paths through the function, so each is isolated separately below:
//
//   - the initial-fetch site is isolated by passing an http(s) URL as
//     `startingHtmlOrUrl`, which is what triggers that branch;
//   - the mid-chain site is isolated by passing raw HTML (not a URL) as
//     `startingHtmlOrUrl` instead — resolveDrillChain treats non-URL input as
//     already-fetched HTML and skips the initial fetch entirely (see
//     data-handler.utility.ts's own `startsWith("http")` branch), landing
//     directly in the chain loop where the second call site lives.
//
// resolveDrillChain deliberately swallows fetch failures and returns "" on
// any failure, per its existing catch blocks — that is pre-existing,
// intentional behavior this slice does not change (see
// tests/data-handler-outbound-executor.test.ts, a locked sibling test, for
// the same convention). So "refused" here means the same thing it means
// there: the result is "" or omits leaked content, and — the stronger,
// request-count-based proof — the FlareSolverr stand-in server was never
// actually contacted.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { resolveDrillChain } from "../utilities/data-handler.utility";

const cleanups: Array<() => void> = [];
const originalAllowlistEnv = process.env.OUTBOUND_FETCH_ALLOWLIST;

afterEach(() => {
	process.env.OUTBOUND_FETCH_ALLOWLIST = originalAllowlistEnv;
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

// resolveDrillChain has no policyOptions parameter of its own — its
// non-FlareSolverr branch already calls getGlobalFetchPolicyOptions()
// directly (see data-handler.utility.ts), and the fix for the FlareSolverr
// branches is expected to do the same. The env var is the only lever this
// function's public signature exposes for permitting a loopback stand-in
// server, and is the same mechanism the locked
// tests/feed-updater-worker-outbound-executor.test.ts already relies on.
function allow(...hosts: string[]) {
	process.env.OUTBOUND_FETCH_ALLOWLIST = hosts.join(",");
}

interface StubRoute {
	response?: string;
	solutionStatus?: number;
	message?: string;
}

function startFlareSolverrStub(routes: Record<string, StubRoute>) {
	const requestedUrls: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (req) => {
			const payload = (await req.json()) as { url: string };
			requestedUrls.push(payload.url);
			const route = routes[payload.url] ?? {};
			return Response.json({
				message: route.message ?? "",
				solution: {
					status: route.solutionStatus ?? 200,
					response: route.response ?? "",
				},
			});
		},
	});
	cleanups.push(() => server.stop(true));
	return {
		url: `http://127.0.0.1:${server.port}`,
		requestedUrls,
	};
}

const HOP1_URL = "http://93.184.216.34/start";
const HOP2_URL = "http://93.184.216.34/page2";
const BLOCKED_TARGET_URL = "http://10.0.0.5/start";
const FINAL_MARKER = "drillchain-final-secret-3e0c";

const HOP1_HTML = `<html><body><a id="next" href="/page2">next</a></body></html>`;
const HOP2_HTML = `<html><body><a id="final" href="/${FINAL_MARKER}">final</a></body></html>`;

const TWO_HOP_CHAIN = [
	{ selector: "#next", attribute: "href", isRelative: true, baseUrl: "http://93.184.216.34", stripHtml: false },
	{ selector: "#final", attribute: "href", isRelative: false, baseUrl: "", stripHtml: false },
];

const ONE_STEP_CHAIN = [
	{ selector: "#final", attribute: "href", isRelative: false, baseUrl: "", stripHtml: false },
];

describe("resolveDrillChain — FlareSolverr adapter, initial-fetch call site (requirements 1-3)", () => {
	test("sanity: a permitted endpoint and permitted starting URL fetch through FlareSolverr", async () => {
		allow("127.0.0.1");
		const stub = startFlareSolverrStub({ [HOP1_URL]: { response: HOP2_HTML } });

		const result = await resolveDrillChain(HOP1_URL, ONE_STEP_CHAIN, false, false, {
			enabled: true,
			serverUrl: stub.url,
			timeout: 5000,
		});

		expect(result).toContain(FINAL_MARKER);
		expect(stub.requestedUrls).toEqual([HOP1_URL]);
	});

	test("refuses a blocked (non-allowlisted loopback) endpoint for the initial fetch, without ever contacting it", async () => {
		allow(); // nothing allowlisted
		const stub = startFlareSolverrStub({ [HOP1_URL]: { response: HOP2_HTML } });

		const result = await resolveDrillChain(HOP1_URL, ONE_STEP_CHAIN, false, false, {
			enabled: true,
			serverUrl: stub.url,
			timeout: 5000,
		});

		expect(result).not.toContain(FINAL_MARKER);
		expect(stub.requestedUrls).toEqual([]);
	});

	test("refuses a blocked starting URL even though the endpoint is permitted, without ever contacting the endpoint (requirement 3)", async () => {
		allow("127.0.0.1");
		const stub = startFlareSolverrStub({ [BLOCKED_TARGET_URL]: { response: HOP2_HTML } });

		const result = await resolveDrillChain(BLOCKED_TARGET_URL, ONE_STEP_CHAIN, false, false, {
			enabled: true,
			serverUrl: stub.url,
			timeout: 5000,
		});

		expect(result).not.toContain(FINAL_MARKER);
		expect(
			stub.requestedUrls,
			"the permitted endpoint must never be contacted when the starting URL fails its own, separate validation",
		).toEqual([]);
	});

	test("refuses a FlareSolverr endpoint URL carrying embedded credentials, and never logs the password", async () => {
		allow("127.0.0.1");
		const stub = startFlareSolverrStub({ [HOP1_URL]: { response: HOP2_HTML } });
		const credentialedUrl = stub.url.replace("http://", "http://attacker:hunter2@");

		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await resolveDrillChain(HOP1_URL, ONE_STEP_CHAIN, false, false, {
				enabled: true,
				serverUrl: credentialedUrl,
				timeout: 5000,
			});
			expect(result).not.toContain(FINAL_MARKER);
			expect(stub.requestedUrls).toEqual([]);
			const rendered = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => Bun.inspect(c)).join("\n");
			expect(rendered).not.toContain("hunter2");
		} finally {
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});
});

describe("resolveDrillChain — FlareSolverr adapter, mid-chain-step call site (requirements 1-3)", () => {
	test("sanity: a permitted endpoint fetches the mid-chain step through FlareSolverr", async () => {
		allow("127.0.0.1");
		const stub = startFlareSolverrStub({ [HOP2_URL]: { response: HOP2_HTML } });

		// Raw HTML (not a URL) as the starting value skips the initial-fetch
		// call site entirely, isolating the mid-chain-step call site.
		const result = await resolveDrillChain(HOP1_HTML, TWO_HOP_CHAIN, false, false, {
			enabled: true,
			serverUrl: stub.url,
			timeout: 5000,
		});

		expect(result).toContain(FINAL_MARKER);
		expect(stub.requestedUrls).toEqual([HOP2_URL]);
	});

	test("refuses a blocked (non-allowlisted loopback) endpoint for the mid-chain step, without ever contacting it", async () => {
		allow(); // nothing allowlisted
		const stub = startFlareSolverrStub({ [HOP2_URL]: { response: HOP2_HTML } });

		const result = await resolveDrillChain(HOP1_HTML, TWO_HOP_CHAIN, false, false, {
			enabled: true,
			serverUrl: stub.url,
			timeout: 5000,
		});

		expect(result).not.toContain(FINAL_MARKER);
		expect(stub.requestedUrls).toEqual([]);
	});
});

describe("resolveDrillChain — FlareSolverr adapter, cookie/credential redaction (requirement 6)", () => {
	test("a cookie value is never captured by any console output when a permitted endpoint reports an application-level failure", async () => {
		allow("127.0.0.1");
		const SECRET_COOKIE = "drillchain-cookie-secret-71bd";
		const stub = startFlareSolverrStub({
			[HOP1_URL]: { solutionStatus: 500, message: "captcha unresolved" },
		});

		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			await resolveDrillChain(
				HOP1_URL,
				ONE_STEP_CHAIN,
				false,
				false,
				{ enabled: true, serverUrl: stub.url, timeout: 5000 },
				[{ name: "session", value: SECRET_COOKIE }],
			);

			const rendered = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
				.map((c) => Bun.inspect(c))
				.join("\n");
			expect(rendered).not.toContain(SECRET_COOKIE);
		} finally {
			logSpy.mockRestore();
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});
});
