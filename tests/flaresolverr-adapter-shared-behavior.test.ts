// TDD slice: p3-flaresolverr-adapter
//
// Requirements 4 and 5 are properties of the shared adapter itself, not of
// any one caller, so — like requirement 8's architecture gate and unlike the
// per-call-site SSRF tests in the other files here — these are proved once,
// through a single representative public entry point
// (utilities/selector-suggestion.utility.ts's suggestSelectors, chosen
// because it needs no worker thread or browser launch to exercise). If the
// adapter genuinely centralizes the FlareSolverr call, as requirement 1
// requires, a property proved through one caller holds for all seven.
//
// Requirement 4 — "bind requests to the validated destination... If address
// pinning cannot apply here, say why." FlareSolverr is reached over plain
// HTTP in every real deployment (it is a local/internal service; see
// lib/outbound/pinned-request.ts's own note that HTTPS is deliberately left
// unpinned because rewriting the connection authority for TLS breaks
// certificate validation — SNI has to match the hostname, not the pinned
// address). So DNS-rebinding-style pinning applies the same way it does for
// the shared executor's ordinary HTTP fetches (already covered by the locked
// tests/outbound-executor.utility.test.ts at the primitive level: this slice
// reuses that primitive rather than re-proving pinning mechanics). What is
// specific to FlareSolverr and not yet covered anywhere is redirect
// handling on the *endpoint* leg: FlareSolverr's own HTTP response could
// itself be a redirect, and axios follows redirects by default. Left
// unchecked, a validated, permitted FlareSolverr endpoint could redirect the
// POST to an internal address that was never validated at all. This test
// proves that redirect is not blindly followed — the same `maxRedirects: 0`
// discipline lib/outbound/pinned-request.ts already applies to every other
// outbound call.
//
// Requirement 5 — "prove the adapter enforces an overall deadline... and
// that a hostile-large timeout cannot extend it indefinitely... with a
// server that delays, not by asserting a number was passed." Proved with a
// FlareSolverr stand-in that never responds, and a `flaresolverr.timeout`
// far larger than any sane per-request budget.
//
// Assumption flagged for the lead (also called out in the accompanying
// report): this test assumes the adapter's total budget is reachable
// through the same FEED_RUN_TIMEOUT_MS / feed_run_timeout_ms setting
// utilities/fetch-policy.utility.ts already uses as "the" total-budget knob
// for ordinary outbound fetches (default 120000ms, clamped to a 1s-10min
// range) — reusing the one existing budget concept rather than inventing a
// FlareSolverr-specific one. If the real implementation enforces its budget
// a different way, this test's env var will have no effect and its outer
// ceiling (comfortably below the hostile value, but not tied to the setting)
// is what actually proves the property; only the *speed* of getting to
// green depends on the assumption. If the adapter's genuine intended budget
// exceeds this test's ceiling, this test will need that ceiling widened —
// please advise rather than have it silently loosened.

import { afterEach, describe, expect, test } from "bun:test";
import { suggestSelectors } from "../utilities/selector-suggestion.utility";

const cleanups: Array<() => void> = [];
const originalFeedRunTimeout = process.env.FEED_RUN_TIMEOUT_MS;

afterEach(() => {
	process.env.FEED_RUN_TIMEOUT_MS = originalFeedRunTimeout;
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

function startServer(hostname: string, fetchHandler: (req: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname, port: 0, fetch: fetchHandler });
	cleanups.push(() => server.stop(true));
	return { url: `http://${hostname}:${server.port}`, port: server.port };
}

const PERMITTED_TARGET_URL = "http://93.184.216.34/list";

describe("suggestSelectors — FlareSolverr adapter binds to the validated destination (requirement 4)", () => {
	test(
		"a redirect returned by the FlareSolverr endpoint itself is not followed to an unvalidated address",
		async () => {
			const LEAK_MARKER = "flaresolverr-endpoint-redirect-leak-8a2c";
			let hop2Requests = 0;
			const hop2 = startServer("127.0.0.2", () => {
				hop2Requests++;
				return Response.json({ solution: { status: 200, response: `<html>${LEAK_MARKER}</html>` } });
			});
			const hop1 = startServer("127.0.0.1", () => {
				return new Response(null, {
					status: 302,
					headers: { location: `http://127.0.0.2:${hop2.port}/v1` },
				});
			});

			let caught: unknown;
			let result: Awaited<ReturnType<typeof suggestSelectors>> | undefined;
			try {
				result = await suggestSelectors(
					PERMITTED_TARGET_URL,
					{ enabled: true, serverUrl: hop1.url, timeout: 5000 },
					undefined,
					// Only hop 1's exact address is permitted; hop 2 is a
					// different address entirely (127.0.0.2), so it must stay
					// blocked even though hop 1 is fine.
					{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
				);
			} catch (error) {
				caught = error;
			}

			expect(
				hop2Requests,
				`hop 2 must never be reached by an unrevalidated FlareSolverr-endpoint redirect; ` +
					`result was ${JSON.stringify(result)}, caught was ${String(caught)}`,
			).toBe(0);
		},
		10_000,
	);
});

describe("suggestSelectors — FlareSolverr adapter enforces a total budget (requirement 5)", () => {
	test(
		"a hostile-large flaresolverr.timeout does not let the call outlive a bounded overall deadline",
		async () => {
			// Well within a 32-bit signed setTimeout delay (~24.8 days), so it
			// cannot silently overflow to an immediate fire the way a truly
			// astronomical value could — this is a "feed author configured
			// something absurd", not a numeric-overflow trick.
			const HOSTILE_TIMEOUT_MS = 2_000_000_000;
			// Generous relative to any sane single-request budget, but the test
			// itself does not hang forever regardless of outcome: the endpoint
			// simply never responds, and cleanup force-closes it afterward.
			const CEILING_MS = 20_000;

			process.env.FEED_RUN_TIMEOUT_MS = "2000";

			const neverResponds = startServer("127.0.0.1", async () => {
				await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
				return new Response("too late");
			});

			const CEILING = Symbol("ceiling-exceeded");
			const startedAt = Date.now();
			const outcome = await Promise.race([
				suggestSelectors(
					PERMITTED_TARGET_URL,
					{ enabled: true, serverUrl: neverResponds.url, timeout: HOSTILE_TIMEOUT_MS },
					undefined,
					{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
				)
					.then((r) => ({ ok: true as const, r }))
					.catch((e) => ({ ok: false as const, e })),
				new Promise((resolve) => setTimeout(() => resolve(CEILING), CEILING_MS)),
			]);
			const elapsed = Date.now() - startedAt;

			expect(
				outcome,
				`the call must settle (via an enforced total budget) well before ${CEILING_MS}ms even though ` +
					`flaresolverr.timeout asked for ${HOSTILE_TIMEOUT_MS}ms; it was still pending at ${elapsed}ms`,
			).not.toBe(CEILING);
		},
		25_000,
	);
});
