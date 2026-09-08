// TDD slice: p3-browser-adapter
//
// Specifies lib/outbound/browser-adapter.ts directly: the browser half of
// Packet 3's adapter bullet (roadmap line 205) — "intercept browser
// subresources, enforce total budgets ... Prohibit direct fetch, Axios,
// FlareSolverr posts, or browser navigation outside approved low-level
// adapters". This suite proves the adapter's own contract (requirements 1-6
// of the brief); tests/browser-adapter-static-guard.test.ts proves
// requirement 7 (no call site outside the adapter); the three
// tests/browser-adapter-{data-handler,preview-generator,worker}.test.ts
// files prove the four call sites actually route through it.
//
// "Do not launch a real Chromium in these tests" (brief, Notes for the test
// author) is satisfied here via an injectable browser factory,
// `req._launchBrowser`, which mirrors the `_dnsLookupFn`/`_skipDns`
// test-injection convention already established on `OutboundFetchPolicyOptions`
// in utilities/outbound-fetch-policy.utility.ts. No real network or browser
// process is ever touched. tests/helpers/fake-browser.ts documents why the
// three call-site migration suites use the brief's other sanctioned
// technique (mocking the "patchright" module) instead: those call sites have
// no injection point of their own.
//
// Literal public/private addresses (not hostnames needing DNS) follow the
// same convention tests/flaresolverr-adapter-data-handler.test.ts uses, so
// no DNS mocking is needed either.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setSystemTime,
	spyOn,
	test,
} from "bun:test";
import type { BrowserFetchRequest } from "../lib/outbound/browser-adapter";
import {
	fetchWithBrowser,
	openBrowserSession,
} from "../lib/outbound/browser-adapter";
import { BrowserHarness } from "./helpers/fake-browser";

const PUBLIC_URL = "http://93.184.216.34/start";
const PUBLIC_URL_2 = "http://93.184.216.34/page2";
const PUBLIC_SUB = "http://93.184.216.34/style.css";
const PRIVATE_URL = "http://10.0.0.5/private";
const PRIVATE_SUB = "http://10.0.0.5/admin";
const PRIVATE_SUB_2 = "http://10.0.0.6/admin2";
const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

const harness = new BrowserHarness();

beforeEach(() => {
	harness.reset();
});

afterEach(() => {
	setSystemTime();
});

function baseRequest(
	overrides: Partial<BrowserFetchRequest> = {},
): BrowserFetchRequest {
	return {
		url: PUBLIC_URL,
		policyOptions: {},
		budgetMs: 30000,
		_launchBrowser: harness.launch,
		...overrides,
	} as BrowserFetchRequest;
}

describe("requirement 1: every navigate() call is validated, not once at session open", () => {
	test("opening a session against a blocked URL neither throws nor navigates anywhere on its own", async () => {
		const session = await openBrowserSession(baseRequest({ url: PRIVATE_URL }));
		expect(harness.gotoCalls.length).toBe(0);
		await session.close();
	});

	test("navigate() rejects a blocked target before ever calling page.goto", async () => {
		const session = await openBrowserSession(baseRequest());
		await expect(session.navigate(PRIVATE_URL)).rejects.toThrow();
		expect(harness.gotoCalls.length).toBe(0);
		await session.close();
	});

	test("navigate() rejects a malformed URL before ever calling page.goto", async () => {
		const session = await openBrowserSession(baseRequest());
		await expect(session.navigate("not a url")).rejects.toThrow();
		expect(harness.gotoCalls.length).toBe(0);
		await session.close();
	});

	test("navigate() rejects a cloud metadata address even with a permissive allowlist/allowPrivateFetches policy (absolute block)", async () => {
		const session = await openBrowserSession(
			baseRequest({
				policyOptions: {
					allowPrivateFetches: true,
					allowlist: ["169.254.169.254"],
				},
			}),
		);
		await expect(session.navigate(METADATA_URL)).rejects.toThrow();
		expect(harness.gotoCalls.length).toBe(0);
		await session.close();
	});

	test("a permitted first navigation succeeds, then a second navigation to a metadata address on the SAME session is refused (drill-chain step N is as untrusted as step 1)", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>hop1</html>");
		const session = await openBrowserSession(baseRequest());
		const first = await session.navigate(PUBLIC_URL);
		expect(first).toContain("hop1");
		await expect(session.navigate(METADATA_URL)).rejects.toThrow();
		// The metadata navigate never reached goto at all -- only the first,
		// permitted hop shows up.
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([PUBLIC_URL]);
		await session.close();
	});
});

describe("requirement 2/3: every subresource is validated, and a refusal does not fail the page", () => {
	test("a private-address subresource is aborted while the document still renders", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		harness.subresourcesByUrl.set(PUBLIC_URL, [PRIVATE_SUB, PUBLIC_SUB]);
		const session = await openBrowserSession(baseRequest());
		const html = await session.navigate(PUBLIC_URL);
		expect(html).toContain("document");
		expect(harness.routeVerdicts).toContainEqual({
			url: PRIVATE_SUB,
			action: "abort",
			isNavigation: false,
		});
		expect(harness.routeVerdicts).toContainEqual({
			url: PUBLIC_SUB,
			action: "continue",
			isNavigation: false,
		});
		await session.close();
	});

	test("the main document request is itself run through the same route handler (belt and braces with requirement 1)", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		const session = await openBrowserSession(baseRequest());
		await session.navigate(PUBLIC_URL);
		expect(harness.routeVerdicts).toContainEqual({
			url: PUBLIC_URL,
			action: "continue",
			isNavigation: true,
		});
		await session.close();
	});

	test("refused subresources are counted on the session", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		harness.subresourcesByUrl.set(PUBLIC_URL, [PRIVATE_SUB]);
		const session = await openBrowserSession(baseRequest());
		await session.navigate(PUBLIC_URL);
		expect(session.refusedSubresourceCount).toBe(1);
		await session.close();
	});

	test("refusals are logged once per navigation, not once per refused subresource", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		harness.subresourcesByUrl.set(PUBLIC_URL, [PRIVATE_SUB, PRIVATE_SUB_2]);
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const session = await openBrowserSession(baseRequest());
			await session.navigate(PUBLIC_URL);
			expect(warnSpy.mock.calls.length).toBe(1);
			await session.close();
		} finally {
			warnSpy.mockRestore();
		}
	});

	test("a subresource URL carrying embedded credentials is refused, and the credential never reaches console output", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		const credentialedSub = "http://attacker:hunter2@93.184.216.34/x";
		harness.subresourcesByUrl.set(PUBLIC_URL, [credentialedSub]);
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const session = await openBrowserSession(baseRequest());
			await session.navigate(PUBLIC_URL);
			expect(
				harness.routeVerdicts.some(
					(v) => v.url === credentialedSub && v.action === "abort",
				),
				"expected the credentialed subresource to be aborted",
			).toBe(true);
			const rendered = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
				.map((c) => Bun.inspect(c))
				.join("\n");
			expect(rendered).not.toContain("hunter2");
			await session.close();
		} finally {
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});

	test("a subresource on an explicit allowlist is continued despite being a private address", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>document</html>");
		harness.subresourcesByUrl.set(PUBLIC_URL, [PRIVATE_SUB]);
		const session = await openBrowserSession(
			baseRequest({ policyOptions: { allowlist: ["10.0.0.5"] } }),
		);
		await session.navigate(PUBLIC_URL);
		expect(harness.routeVerdicts).toContainEqual({
			url: PRIVATE_SUB,
			action: "continue",
			isNavigation: false,
		});
		await session.close();
	});
});

describe("requirement 4: redirects are revalidated at every hop", () => {
	test("a permitted first hop that redirects to a private address is refused at the hop, not followed", async () => {
		harness.redirectChains.set(PUBLIC_URL, [PUBLIC_URL, PRIVATE_URL]);
		const session = await openBrowserSession(baseRequest());
		await expect(session.navigate(PUBLIC_URL)).rejects.toThrow();
		// One goto call was made (one navigation attempt); both hops it covers
		// were independently run through the route handler.
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([PUBLIC_URL]);
		expect(harness.routeVerdicts.filter((v) => v.isNavigation)).toEqual([
			{ url: PUBLIC_URL, action: "continue", isNavigation: true },
			{ url: PRIVATE_URL, action: "abort", isNavigation: true },
		]);
		await session.close();
	});

	test("a redirect that stays public at every hop succeeds and returns the final hop's content", async () => {
		harness.redirectChains.set(PUBLIC_URL, [PUBLIC_URL, PUBLIC_URL_2]);
		harness.htmlByUrl.set(PUBLIC_URL_2, "<html>final destination</html>");
		const session = await openBrowserSession(baseRequest());
		const html = await session.navigate(PUBLIC_URL);
		expect(html).toContain("final destination");
		await session.close();
	});
});

describe("requirement 5: one budget bounds the whole session", () => {
	test("the launch timeout is derived from budgetMs, not the old hardcoded 60s default", async () => {
		const session = await openBrowserSession(baseRequest({ budgetMs: 500 }));
		expect(harness.launchOptionsCalls.length).toBe(1);
		const timeout = harness.launchOptionsCalls[0].timeout;
		expect(typeof timeout).toBe("number");
		expect(timeout as number).toBeGreaterThan(0);
		expect(timeout as number).toBeLessThanOrEqual(500);
		await session.close();
	});

	test("a session past its deadline refuses to navigate, without attempting to open the page", async () => {
		const start = new Date("2026-01-01T00:00:00.000Z");
		setSystemTime(start);
		const session = await openBrowserSession(baseRequest({ budgetMs: 1000 }));
		setSystemTime(new Date(start.getTime() + 1500));
		await expect(session.navigate(PUBLIC_URL)).rejects.toThrow();
		expect(harness.gotoCalls.length).toBe(0);
		await session.close();
	});

	test("budget is one deadline across the whole session -- a second navigate does not get a fresh clock", async () => {
		const start = new Date("2026-01-01T00:00:00.000Z");
		setSystemTime(start);
		harness.htmlByUrl.set(PUBLIC_URL, "<html>one</html>");
		const session = await openBrowserSession(baseRequest({ budgetMs: 1000 }));
		const first = await session.navigate(PUBLIC_URL);
		expect(first).toContain("one");

		setSystemTime(new Date(start.getTime() + 1200)); // now past the 1000ms budget
		await expect(session.navigate(PUBLIC_URL_2)).rejects.toThrow();
		// The second navigate's target never reached goto.
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([PUBLIC_URL]);
		await session.close();
	});
});

describe("requirement 6: the browser always closes", () => {
	test("openBrowserSession closes the browser if setup fails after launch", async () => {
		harness.failNewPage = true;
		await expect(openBrowserSession(baseRequest())).rejects.toThrow();
		expect(harness.browserCloseCount).toBe(1);
	});

	test("fetchWithBrowser closes the browser when the target is refused by policy", async () => {
		await expect(
			fetchWithBrowser(baseRequest({ url: PRIVATE_URL })),
		).rejects.toThrow();
		expect(harness.gotoCalls.length).toBe(0);
		expect(harness.browserCloseCount).toBe(1);
	});

	test("fetchWithBrowser closes the browser when goto throws an unrelated error mid-navigation", async () => {
		harness.gotoThrows.set(PUBLIC_URL, new Error("ECONNRESET"));
		await expect(
			fetchWithBrowser(baseRequest({ url: PUBLIC_URL })),
		).rejects.toThrow(/ECONNRESET/);
		expect(harness.browserCloseCount).toBe(1);
	});

	test("fetchWithBrowser closes the browser exactly once on the happy path", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>ok</html>");
		const html = await fetchWithBrowser(baseRequest({ url: PUBLIC_URL }));
		expect(html).toContain("ok");
		expect(harness.browserCloseCount).toBe(1);
	});

	test("session.navigate() being refused does not itself close the browser -- the caller's own close() does (data-handler's finally delegates)", async () => {
		const session = await openBrowserSession(baseRequest());
		await expect(session.navigate(PRIVATE_URL)).rejects.toThrow();
		expect(harness.browserCloseCount).toBe(0);
		await session.close();
		expect(harness.browserCloseCount).toBe(1);
	});

	test("session.close() is idempotent -- closing twice does not double-close the browser", async () => {
		const session = await openBrowserSession(baseRequest());
		await session.close();
		await session.close();
		expect(harness.browserCloseCount).toBe(1);
	});
});

describe("networkidle-timeout tolerance (deliberate, load-bearing) vs. a genuine policy refusal", () => {
	test("a bare networkidle wait timeout, with no policy refusal involved, does not fail navigate() -- the current page state is used", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>loaded-anyway</html>");
		harness.networkidleTimeoutUrls.add(PUBLIC_URL);
		const session = await openBrowserSession(baseRequest());
		const html = await session.navigate(PUBLIC_URL);
		expect(html).toContain("loaded-anyway");
		await session.close();
	});

	test("a policy refusal on a redirect hop is NOT swallowed by the networkidle tolerance -- it still rejects", async () => {
		harness.redirectChains.set(PUBLIC_URL, [PUBLIC_URL, PRIVATE_URL]);
		const session = await openBrowserSession(baseRequest());
		await expect(session.navigate(PUBLIC_URL)).rejects.toThrow();
		await session.close();
	});
});

describe("behaviour that must survive migration into the adapter", () => {
	test("registers a navigator.webdriver-hiding init script", async () => {
		const session = await openBrowserSession(baseRequest());
		expect(harness.contexts.length).toBe(1);
		expect(harness.contexts[0].initScripts.length).toBeGreaterThan(0);
		expect(harness.contexts[0].initScripts[0].toString()).toContain(
			"webdriver",
		);
		await session.close();
	});

	test("uses the caller-supplied user agent verbatim when given", async () => {
		const session = await openBrowserSession(
			baseRequest({ userAgent: "test-agent/1.0" }),
		);
		expect(harness.contexts[0].options?.userAgent).toBe("test-agent/1.0");
		await session.close();
	});

	test("generates a non-empty user agent when none is supplied", async () => {
		const session = await openBrowserSession(
			baseRequest({ userAgent: undefined }),
		);
		const userAgent = harness.contexts[0].options?.userAgent;
		expect(typeof userAgent).toBe("string");
		expect((userAgent ?? "").length).toBeGreaterThan(0);
		await session.close();
	});

	test("applies per-feed extra headers to the page", async () => {
		harness.htmlByUrl.set(PUBLIC_URL, "<html>ok</html>");
		const session = await openBrowserSession(
			baseRequest({ headers: { "X-Test": "abc" } }),
		);
		await session.navigate(PUBLIC_URL);
		expect(harness.contexts[0].pages[0]?.extraHeaders).toEqual({
			"X-Test": "abc",
		});
		await session.close();
	});

	test("injects cookies with a domain derived from the request URL's hostname", async () => {
		const session = await openBrowserSession(
			baseRequest({
				url: PUBLIC_URL,
				cookies: [{ name: "session", value: "secret-cookie-abc" }],
			}),
		);
		expect(harness.contexts[0].cookiesAdded).toEqual([
			{
				name: "session",
				value: "secret-cookie-abc",
				domain: "93.184.216.34",
				path: "/",
			},
		]);
		await session.close();
	});
});
