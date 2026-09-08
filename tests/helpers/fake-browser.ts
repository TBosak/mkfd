import { mock } from "bun:test";

/**
 * A minimal, in-memory stand-in for the slice of Patchright's async
 * Browser/BrowserContext/Page/Route API that `lib/outbound/browser-adapter.ts`
 * needs. Used two ways by the browser-adapter test suites:
 *
 *  - directly, via `req._launchBrowser: harness.launch` on `BrowserFetchRequest`
 *    (mirrors the `_dnsLookupFn`/`_skipDns` injectable-test-hook convention
 *    already established on `OutboundFetchPolicyOptions` in
 *    utilities/outbound-fetch-policy.utility.ts) — used by
 *    tests/browser-adapter.test.ts for full, isolated control with no global
 *    module mutation;
 *  - via `mockPatchright(harness)`, which replaces the real "patchright"
 *    module's `chromium.launch` for the whole test file — used by the three
 *    call-site migration suites, which have no injection point of their own
 *    and must prove the *real* call sites (still calling `chromium.launch`
 *    directly, pre-migration) never reach a real browser process either.
 *
 * Never launches a real Chromium process.
 */

export type RouteAction = "abort" | "continue";

export interface RouteVerdict {
	url: string;
	action: RouteAction;
	isNavigation: boolean;
}

export interface FakeRequestLike {
	url(): string;
	isNavigationRequest(): boolean;
}

export interface FakeRouteLike {
	request(): FakeRequestLike;
	abort(reason?: string): Promise<void>;
	continue(): Promise<void>;
}

export type FakeRouteHandler = (
	route: FakeRouteLike,
	request: FakeRequestLike,
) => void | Promise<void>;

export interface FakeCookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
}

export class FakePage {
	closed = false;
	extraHeaders: Record<string, string> | undefined;
	currentHtml = "";
	readonly gotoOptionsCalls: Array<Record<string, unknown> | undefined> = [];

	constructor(
		private readonly harness: BrowserHarness,
		private readonly ctx: FakeContext,
	) {}

	async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
		this.extraHeaders = headers;
	}

	/** Mirrors Playwright's `page.context()`, returning the page's owning context. */
	context(): FakeContext {
		return this.ctx;
	}

	async goto(url: string, opts?: Record<string, unknown>): Promise<null> {
		this.harness.gotoCalls.push({ url, opts });
		this.gotoOptionsCalls.push(opts);

		const hops = this.harness.redirectChains.get(url) ?? [url];
		for (const hop of hops) {
			const verdict = await this.harness.fireRoute(
				this.ctx.routeHandler,
				hop,
				true,
			);
			if (verdict === "abort") {
				throw new Error(`net::ERR_ABORTED at ${hop}`);
			}
		}

		const finalHop = hops[hops.length - 1];
		this.currentHtml =
			this.harness.htmlByUrl.get(finalHop) ??
			`<html><body>${finalHop}</body></html>`;

		const forcedError = this.harness.gotoThrows.get(url);
		if (forcedError) throw forcedError;
		if (this.harness.networkidleTimeoutUrls.has(url)) {
			throw new Error(
				'page.goto: Timeout 10000ms exceeded while waiting for event "networkidle"',
			);
		}

		for (const sub of this.harness.subresourcesByUrl.get(url) ?? []) {
			await this.harness.fireRoute(this.ctx.routeHandler, sub, false);
		}

		return null;
	}

	async content(): Promise<string> {
		return this.currentHtml;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

export class FakeContext {
	routeHandler: FakeRouteHandler | null = null;
	routePattern: string | null = null;
	readonly initScripts: Array<() => void> = [];
	readonly cookiesAdded: FakeCookie[] = [];
	readonly pages: FakePage[] = [];
	closed = false;

	constructor(
		private readonly harness: BrowserHarness,
		public readonly options: { userAgent?: string } | undefined,
	) {}

	async addInitScript(fn: () => void): Promise<void> {
		this.initScripts.push(fn);
	}

	async route(pattern: string, handler: FakeRouteHandler): Promise<void> {
		this.routePattern = pattern;
		this.routeHandler = handler;
	}

	async addCookies(cookies: FakeCookie[]): Promise<void> {
		this.cookiesAdded.push(...cookies);
	}

	async newPage(): Promise<FakePage> {
		if (this.harness.failNewPage) {
			throw new Error("simulated context.newPage() failure");
		}
		const page = new FakePage(this.harness, this);
		this.pages.push(page);
		return page;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

class FakeBrowser {
	closed = false;

	constructor(private readonly harness: BrowserHarness) {}

	async newContext(options?: { userAgent?: string }): Promise<FakeContext> {
		if (this.harness.failNewContext) {
			throw new Error("simulated browser.newContext() failure");
		}
		const ctx = new FakeContext(this.harness, options);
		this.harness.contexts.push(ctx);
		return ctx;
	}

	async close(): Promise<void> {
		this.closed = true;
		this.harness.browserCloseCount += 1;
	}
}

export class BrowserHarness {
	readonly launchOptionsCalls: Array<Record<string, unknown>> = [];
	readonly gotoCalls: Array<{ url: string; opts?: Record<string, unknown> }> =
		[];
	readonly routeVerdicts: RouteVerdict[] = [];
	readonly contexts: FakeContext[] = [];
	browserCloseCount = 0;

	/** document-url -> ordered hop chain (e.g. a redirect from a public host to a private one). Defaults to [url]. */
	readonly redirectChains = new Map<string, string[]>();
	/** document-url (as passed to goto) -> subresource urls fired as non-navigation route requests during that goto. */
	readonly subresourcesByUrl = new Map<string, string[]>();
	/** final hop url -> html content() resolves to after a successful goto. */
	readonly htmlByUrl = new Map<string, string>();
	/** document-urls whose goto() throws a generic Playwright-style networkidle timeout, AFTER route verdicts all continue. */
	readonly networkidleTimeoutUrls = new Set<string>();
	/** document-url -> an arbitrary unrelated Error goto() should throw (after route verdicts all continue), for close-on-error tests. */
	readonly gotoThrows = new Map<string, Error>();
	failNewContext = false;
	failNewPage = false;

	launch = async (options: Record<string, unknown>): Promise<FakeBrowser> => {
		this.launchOptionsCalls.push(options);
		return new FakeBrowser(this);
	};

	async fireRoute(
		handler: FakeRouteHandler | null,
		url: string,
		isNavigation: boolean,
	): Promise<RouteAction> {
		if (!handler) {
			// No route handler registered at all: nothing intercepts the request.
			// A real, unmigrated call site behaves exactly this way — which is
			// the point: it lets a pre-migration test observe "nothing was
			// validated" as a real, distinguishing effect (a goto/subresource
			// that should have been refused instead goes through).
			this.routeVerdicts.push({ url, action: "continue", isNavigation });
			return "continue";
		}
		let verdict: RouteAction = "continue";
		const request: FakeRequestLike = {
			url: () => url,
			isNavigationRequest: () => isNavigation,
		};
		const route: FakeRouteLike = {
			request: () => request,
			abort: async () => {
				verdict = "abort";
			},
			continue: async () => {
				verdict = "continue";
			},
		};
		await handler(route, request);
		this.routeVerdicts.push({ url, action: verdict, isNavigation });
		return verdict;
	}

	/** Resets all recorded calls/state and configuration, keeping the same harness instance (and any active `mockPatchright` wiring) alive across tests in one file. */
	reset(): void {
		this.launchOptionsCalls.length = 0;
		this.gotoCalls.length = 0;
		this.routeVerdicts.length = 0;
		this.contexts.length = 0;
		this.browserCloseCount = 0;
		this.redirectChains.clear();
		this.subresourcesByUrl.clear();
		this.htmlByUrl.clear();
		this.networkidleTimeoutUrls.clear();
		this.gotoThrows.clear();
		this.failNewContext = false;
		this.failNewPage = false;
	}
}

/**
 * Replaces the real "patchright" module's `chromium.launch` with the given
 * harness's fake launcher, for the lifetime of the current test file (until
 * `mock.restore()` is called, e.g. in an `afterAll`). Only `chromium` needs a
 * runtime value — every other named import call sites use from "patchright"
 * (`Browser`, `Cookie`, `Page`) is type-only and erased before this ever runs.
 */
export function mockPatchright(harness: BrowserHarness): void {
	mock.module("patchright", () => ({
		chromium: { launch: harness.launch },
	}));
}
