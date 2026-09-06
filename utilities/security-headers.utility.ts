import type { Context, MiddlewareHandler, Next } from "hono";

/**
 * The Selector Playground response sets its own, deliberately different,
 * Content-Security-Policy in routes/utils.ts, and the accepted
 * `p2-selector-playground-isolation` suite asserts that policy exactly —
 * nothing appended, nothing dropped. The app-wide policy must therefore skip
 * it entirely rather than merge with it.
 *
 * That also settles framing for `/proxy`: it cannot be given its own
 * `frame-ancestors` without appending to a locked policy, so it is exempt.
 * It is a sandboxed, opaque-origin document behind the session gate, which is
 * what actually contains it.
 */
const OWNS_ITS_OWN_POLICY = /^\/proxy(?:[/?#]|$)/;

/**
 * `script-src 'self'` is strict on purpose: `public/index.html` carries a
 * single external module from this origin, so no inline or eval allowance is
 * needed anywhere in the SPA.
 *
 * `style-src` is not strict, and that is a deliberate, stated trade rather
 * than an oversight: 33 components under `frontend/src` use React
 * `style={{ ... }}`, which emits inline `style` attributes. A policy the app
 * cannot actually run under would be worse than an honest one.
 *
 * Do NOT add a nonce or hash to `style-src`. Under CSP2+ the presence of
 * either causes `'unsafe-inline'` to be ignored for that directive, which
 * would break every one of those inline styles.
 *
 * `frame-src` is intentionally absent so it falls back to `default-src
 * 'self'` — the playground legitimately frames `/proxy` from this origin.
 */
const APP_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join("; ");

/** One year, the usual floor for preload eligibility. */
const HSTS_MAX_AGE = 31536000;

/**
 * True only when this request actually arrived over TLS.
 *
 * Derived from the request, deliberately not from the `SSL` startup flag —
 * the same decision `index.ts` makes for the `Secure` cookie. A plain-HTTP
 * LAN install that received HSTS would become unreachable for the max-age,
 * and `SSL=true` left over in an environment must not be able to cause that.
 *
 * `X-Forwarded-Proto` is not consulted. Mkfd has no trusted-proxy
 * configuration surface yet, so honouring it would let any client that can
 * reach the app set a header and lock a browser out of a plaintext install.
 */
function isHttpsRequest(c: Context): boolean {
	try {
		return new URL(c.req.url).protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Applies the baseline security headers to every response that does not own
 * its own policy.
 */
export function securityHeaders(): MiddlewareHandler {
	return async (c: Context, next: Next) => {
		await next();

		if (OWNS_ITS_OWN_POLICY.test(c.req.path)) return;

		c.res.headers.set("Content-Security-Policy", APP_CSP);
		c.res.headers.set("X-Content-Type-Options", "nosniff");
		// NOT "no-referrer". That policy also suppresses the Origin header on
		// form submissions (Chrome sends "Origin: null"), which the CSRF guard
		// added in p2-auth-trust-boundary then rejects — login returns 403 in a
		// browser while curl, which sets Origin itself, still succeeds. Caught
		// only by the Playwright suite; verify:core was entirely green.
		// strict-origin-when-cross-origin is the modern browser default: full
		// URL same-origin, origin only cross-origin, nothing on downgrade.
		c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
		// frame-ancestors covers modern agents; X-Frame-Options is the legacy
		// equivalent for those that do not implement it.
		c.res.headers.set("X-Frame-Options", "DENY");

		if (isHttpsRequest(c)) {
			c.res.headers.set("Strict-Transport-Security", `max-age=${HSTS_MAX_AGE}; includeSubDomains`);
		}
	};
}
