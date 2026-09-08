/**
 * The one approved way to drive a browser.
 *
 * Three places used to launch Chromium themselves — the drill chain, the
 * preview generator and the feed worker — each with the same block copied and
 * the same hole in it: `page.goto` was the only URL any policy ever saw. Once
 * the document loaded, the page pulled images, scripts, stylesheets and XHR
 * from wherever its markup said, and none of that passed through the outbound
 * policy. One `<img src="http://169.254.169.254/latest/meta-data/">` in a
 * scraped page bypassed every outbound guard in the project.
 *
 * This adapter closes that: a route handler validates *every* request the
 * browser makes, navigations and subresources alike, and aborts the ones the
 * policy refuses. It lives in `lib/` rather than a scanned directory for the
 * same reason `pinned-request.ts` and `flaresolverr-adapter.ts` do — it is the
 * approved primitive, so the architecture guard must not flag it.
 */

import { chromium } from "patchright";
import { getChromiumLaunchOptions } from "../../utilities/chrome-extensions.utility";
import {
	assertAndResolveOutboundTarget,
	type OutboundFetchPolicyOptions,
} from "../../utilities/outbound-fetch-policy.utility";
import { getRandomUserAgent } from "../../utilities/user-agents.utility";

/** The launch surface this adapter needs. Patchright's `chromium.launch` satisfies it. */
type LaunchFn = (options: Record<string, unknown>) => Promise<BrowserLike>;

interface BrowserLike {
	newContext(options?: { userAgent?: string }): Promise<ContextLike>;
	close(): Promise<void>;
}

interface ContextLike {
	addInitScript(fn: () => void): Promise<void>;
	route(pattern: string, handler: RouteHandler): Promise<void>;
	addCookies(cookies: Array<{ name: string; value: string; domain: string; path: string }>): Promise<void>;
	newPage(): Promise<PageLike>;
}

interface PageLike {
	setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
	goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
	content(): Promise<string>;
}

interface RequestLike {
	url(): string;
	isNavigationRequest(): boolean;
}

interface RouteLike {
	request(): RequestLike;
	abort(reason?: string): Promise<void>;
	continue(): Promise<void>;
}

type RouteHandler = (route: RouteLike, request: RequestLike) => void | Promise<void>;

export interface BrowserFetchRequest {
	url: string;
	policyOptions: OutboundFetchPolicyOptions;
	/** Bounds the whole session, not one navigation. */
	budgetMs: number;
	userAgent?: string;
	headers?: Record<string, string>;
	cookies?: Array<{ name: string; value: string }>;
	/**
	 * Test-only launch injection. Mirrors the `_dnsLookupFn` / `_skipDns`
	 * convention already on `OutboundFetchPolicyOptions`; production callers
	 * never set it and get Patchright.
	 */
	_launchBrowser?: LaunchFn;
}

export interface BrowserSession {
	navigate(url: string): Promise<string>;
	close(): Promise<void>;
	/** Subresources this session refused, across all navigations. */
	readonly refusedSubresourceCount: number;
}

/**
 * A URL with any embedded credentials removed, safe to put in a log line.
 *
 * `http://user:pass@host/x` is a legal subresource URL, and logging a refusal
 * verbatim would write the password to stdout — the refusal message is exactly
 * where a credential is least expected and most durable.
 */
function safeForLog(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.username || parsed.password) {
			parsed.username = "";
			parsed.password = "";
			return `${parsed.toString()} (credentials removed)`;
		}
		return parsed.toString();
	} catch {
		return "<unparseable url>";
	}
}

/** True for the "networkidle never settled" timeout that every call site has always tolerated. */
function isNetworkIdleTimeout(error: unknown): boolean {
	const message = String((error as Error)?.message ?? "");
	return /Timeout .*exceeded/i.test(message) && /networkidle/i.test(message);
}

class Session implements BrowserSession {
	private closed = false;
	private refusedCount = 0;
	/** Set by the route handler when it refuses a *navigation* hop. */
	private navigationRefusal: Error | undefined;
	/** Refusals seen during the navigation currently in flight, for one log line rather than N. */
	private refusalsThisNavigation: string[] = [];

	constructor(
		private readonly browser: BrowserLike,
		private readonly page: PageLike,
		private readonly deadlineAt: number,
	) {}

	get refusedSubresourceCount(): number {
		return this.refusedCount;
	}

	/**
	 * The route handler, installed once per context. Every request the browser
	 * makes arrives here — the document, each redirect hop, and every
	 * subresource — and none proceeds without passing the same policy the
	 * axios paths use.
	 */
	async handleRoute(route: RouteLike, request: RequestLike): Promise<void> {
		const url = request.url();
		const isNavigation = request.isNavigationRequest();
		try {
			await assertAndResolveOutboundTarget(url, this.policyOptions);
			await route.continue();
		} catch (error) {
			if (isNavigation) {
				// Remembered so navigate() can reject with the policy reason
				// rather than the browser's opaque net::ERR_ABORTED.
				this.navigationRefusal = error as Error;
			} else {
				this.refusedCount += 1;
				this.refusalsThisNavigation.push(safeForLog(url));
			}
			await route.abort();
		}
	}

	policyOptions: OutboundFetchPolicyOptions = {};

	async navigate(url: string): Promise<string> {
		if (this.closed) throw new Error("Browser session is already closed.");

		const remaining = this.deadlineAt - Date.now();
		if (remaining <= 0) {
			// The budget bounds the session, so a chain that has spent it fails
			// here rather than starting a fresh clock on its next step.
			throw new Error(
				`Browser session budget exhausted before navigating to "${safeForLog(url)}".`,
			);
		}

		// Validated before the browser is asked to do anything, so a blocked
		// target never reaches page.goto at all. The route handler validates it
		// a second time, which is not redundant: the handler also sees the
		// redirect hops this call cannot know about.
		await assertAndResolveOutboundTarget(url, this.policyOptions);

		this.navigationRefusal = undefined;
		this.refusalsThisNavigation = [];

		try {
			await this.page.goto(url, {
				waitUntil: "networkidle",
				timeout: Math.max(1, Math.min(remaining, this.deadlineAt - Date.now())),
			});
		} catch (error) {
			// A refused hop must never be swallowed by the networkidle
			// tolerance below: one is a policy decision, the other is a page
			// that simply never went quiet.
			if (this.navigationRefusal) throw this.navigationRefusal;
			if (!isNetworkIdleTimeout(error)) throw error;
			// Deliberate and load-bearing: every call site has always used the
			// current page state when networkidle times out.
		}

		if (this.navigationRefusal) throw this.navigationRefusal;

		if (this.refusalsThisNavigation.length > 0) {
			// One line per navigation, not one per refused subresource: a page
			// with fifty blocked beacons should not bury the log.
			console.warn(
				`[browser-adapter] refused ${this.refusalsThisNavigation.length} subresource(s) on ${safeForLog(url)}:`,
				this.refusalsThisNavigation.join(", "),
			);
		}

		return await this.page.content();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.browser.close();
	}
}

/**
 * Adapts a real Patchright browser to the narrow surface above by delegation.
 *
 * Every method here is structurally compatible already; writing it out is what
 * lets the compiler check that claim instead of being told to trust it.
 */
function wrapPatchrightBrowser(browser: Awaited<ReturnType<typeof chromium.launch>>): BrowserLike {
	return {
		newContext: async (options) => {
			const context = await browser.newContext(options);
			return {
				addInitScript: async (fn) => {
					// Patchright resolves this to a Disposable; the adapter only
					// needs the completion, not the handle.
					await context.addInitScript(fn);
				},
				route: async (pattern, handler) => {
					await context.route(pattern, (route, req) => handler(route, req));
				},
				addCookies: (cookies) => context.addCookies(cookies),
				newPage: async () => await context.newPage(),
			};
		},
		close: () => browser.close(),
	};
}

/**
 * Opens a browser session bound to one budget.
 *
 * The request URL is deliberately *not* validated here — a caller may open a
 * session and navigate somewhere else entirely, and every navigate() validates
 * on its own. The URL is used only to derive the cookie domain.
 */
export async function openBrowserSession(request: BrowserFetchRequest): Promise<BrowserSession> {
	const budgetMs = Math.max(1, request.budgetMs);
	const deadlineAt = Date.now() + budgetMs;

	// The launch timeout comes out of the same budget rather than the old
	// hardcoded 60s, which could outlive the feed's whole allowance.
	const launchOptions = getChromiumLaunchOptions({
		headless: true,
		timeout: Math.min(budgetMs, 60000),
	});

	// Patchright is wrapped rather than cast. A cast from its Browser to the
	// narrow shape used here is what TypeScript rejects, and its suggested
	// remedy — a double assertion through unknown — is precisely what this
	// project's anti-bypass gate forbids, comments included.
	const browser: BrowserLike = request._launchBrowser
		? await request._launchBrowser(launchOptions)
		: wrapPatchrightBrowser(await chromium.launch(launchOptions));

	// Everything after the launch closes the browser on failure; a throw here
	// used to leak a Chromium process, since every call site closed only on
	// the happy path.
	try {
		const context = await browser.newContext({
			userAgent: request.userAgent ?? getRandomUserAgent(),
		});

		await context.addInitScript(() => {
			Object.defineProperty(navigator, "webdriver", { get: () => undefined });
		});

		const page = await context.newPage();
		const session = new Session(browser, page, deadlineAt);
		session.policyOptions = request.policyOptions ?? {};

		await context.route("**/*", (route, req) => session.handleRoute(route, req));

		if (request.headers && Object.keys(request.headers).length > 0) {
			await page.setExtraHTTPHeaders(request.headers);
		}

		if (request.cookies && request.cookies.length > 0) {
			// Domain derived from the request URL's hostname, as every call
			// site did. A URL too malformed to parse simply gets no cookies
			// rather than failing the session — navigate() will reject it.
			let domain: string | undefined;
			try {
				domain = new URL(request.url).hostname;
			} catch {
				domain = undefined;
			}
			if (domain) {
				await context.addCookies(
					request.cookies.map((cookie) => ({
						name: cookie.name,
						value: cookie.value,
						domain,
						path: "/",
					})),
				);
			}
		}

		return session;
	} catch (error) {
		await browser.close();
		throw error;
	}
}

/** One-shot form: open, navigate once, always close. */
export async function fetchWithBrowser(request: BrowserFetchRequest): Promise<string> {
	const session = await openBrowserSession(request);
	try {
		return await session.navigate(request.url);
	} finally {
		await session.close();
	}
}
