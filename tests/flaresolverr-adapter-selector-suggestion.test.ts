// TDD slice: p3-flaresolverr-adapter
//
// utilities/selector-suggestion.utility.ts:387 is one of the three call
// sites the brief identifies as currently performing zero outbound-policy
// validation before POSTing to `flaresolverr.serverUrl` — a value the feed
// author supplies. suggestSelectors is that call site's own public entry
// point (the route that fronts it, POST /utils/suggest-selectors, already
// validates the FlareSolverr URL itself before calling in — but that
// duplicated check is exactly the "remembered, not unskippable" problem the
// brief describes: anything else that calls suggestSelectors directly, now
// or in the future, gets none of it). These tests drive suggestSelectors
// itself, bypassing the route's own redundant check, so the function is
// proved safe on its own.
//
// All FlareSolverr endpoints here are real local HTTP servers on loopback
// (127.0.0.1) — nothing here reaches a third-party host. "Permitted" means
// explicitly allowlisted via the policyOptions argument; "blocked" means
// left off that allowlist, which loopback fails by default.
//
// Requirement 3 (endpoint and target validated *separately*) is proved with
// literal IP addresses rather than hostnames for the target, so target
// validation never depends on real DNS: a literal IP is checked directly
// against the blocked-range list with no resolution step.

import { afterEach, describe, expect, test } from "bun:test";
import { suggestSelectors } from "../utilities/selector-suggestion.utility";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

interface StubResult {
	response?: string;
	solutionStatus?: number;
	message?: string;
}

function startFlareSolverrStub(handler: (payload: Record<string, unknown>) => StubResult) {
	let requests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (req) => {
			requests++;
			const payload = (await req.json()) as Record<string, unknown>;
			const result = handler(payload);
			return Response.json({
				message: result.message ?? "",
				solution: {
					status: result.solutionStatus ?? 200,
					response: result.response ?? "",
				},
			});
		},
	});
	cleanups.push(() => server.stop(true));
	return {
		url: `http://127.0.0.1:${server.port}`,
		requestCount: () => requests,
	};
}

// A permitted literal target IP: an ordinary public unicast address, not in
// any private/loopback/link-local/reserved range, so it needs no DNS
// resolution and no allowlist entry to pass policy.
const PERMITTED_TARGET_URL = "http://93.184.216.34/list";
// A blocked literal target IP: RFC 1918 private space.
const BLOCKED_TARGET_URL = "http://10.0.0.5/list";

const MARKER = "selector-suggestion-flaresolverr-marker-9f21";
const REPEATING_ARTICLE_HTML = `
<html><body>
${[1, 2, 3, 4]
	.map(
		(n) => `
<article>
  <h2><a href="/item-${n}">${MARKER} item ${n}</a></h2>
  <p>A sufficiently long description paragraph for item ${n} so that description coverage heuristics pass.</p>
</article>`,
	)
	.join("\n")}
</body></html>`;

describe("suggestSelectors — FlareSolverr adapter (requirements 1-3)", () => {
	test("sanity: a permitted endpoint and a permitted target succeed end to end", async () => {
		const stub = startFlareSolverrStub(() => ({ response: REPEATING_ARTICLE_HTML, solutionStatus: 200 }));

		const result = await suggestSelectors(
			PERMITTED_TARGET_URL,
			{ enabled: true, serverUrl: stub.url, timeout: 5000 },
			undefined,
			{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
		);

		expect(result.iterator.length).toBeGreaterThan(0);
		expect(stub.requestCount()).toBe(1);
	});

	test("refuses a blocked (non-allowlisted loopback) endpoint even though the target is permitted, without ever contacting it", async () => {
		const stub = startFlareSolverrStub(() => ({ response: REPEATING_ARTICLE_HTML }));

		let caught: unknown;
		try {
			await suggestSelectors(
				PERMITTED_TARGET_URL,
				{ enabled: true, serverUrl: stub.url, timeout: 5000 },
				undefined,
				{ allowlist: [], allowPrivateFetches: false },
			);
		} catch (error) {
			caught = error;
		}

		expect(caught, "a blocked FlareSolverr endpoint must be refused").toBeDefined();
		expect(stub.requestCount()).toBe(0);
	});

	test("refuses a blocked target even though the endpoint is permitted, without ever contacting the endpoint (requirement 3)", async () => {
		const stub = startFlareSolverrStub(() => ({ response: REPEATING_ARTICLE_HTML }));

		let caught: unknown;
		try {
			await suggestSelectors(
				BLOCKED_TARGET_URL,
				{ enabled: true, serverUrl: stub.url, timeout: 5000 },
				undefined,
				{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			);
		} catch (error) {
			caught = error;
		}

		expect(caught, "a blocked target url must be refused even when the FlareSolverr endpoint itself is permitted").toBeDefined();
		expect(
			stub.requestCount(),
			"the permitted endpoint must never be contacted when the target fails its own, separate validation",
		).toBe(0);
	});

	test("refuses a FlareSolverr endpoint URL carrying embedded credentials, and never echoes the password", async () => {
		const stub = startFlareSolverrStub(() => ({ response: REPEATING_ARTICLE_HTML }));
		const credentialedUrl = stub.url.replace("http://", "http://attacker:hunter2@");

		let caught: unknown;
		try {
			await suggestSelectors(
				PERMITTED_TARGET_URL,
				{ enabled: true, serverUrl: credentialedUrl, timeout: 5000 },
				undefined,
				{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			);
		} catch (error) {
			caught = error;
		}

		expect(caught, "a credentialed FlareSolverr endpoint must be refused, not silently followed").toBeDefined();
		expect(stub.requestCount()).toBe(0);
		const message = String((caught as Error)?.message ?? caught);
		expect(message).not.toContain("hunter2");
	});

	test("refuses a non-http(s) scheme FlareSolverr endpoint", async () => {
		await expect(
			suggestSelectors(
				PERMITTED_TARGET_URL,
				{ enabled: true, serverUrl: "ftp://127.0.0.1:9/", timeout: 5000 },
				undefined,
				{ allowlist: ["127.0.0.1"], allowPrivateFetches: false },
			),
		).rejects.toThrow(/scheme|blocked|protocol/i);
	});

	// A literal IP rather than the "metadata.google.internal" hostname: this
	// keeps the test deterministic and independent of this machine's DNS
	// resolver (an unqualified internal hostname can resolve unpredictably
	// depending on search-domain configuration). 169.254.169.254 is itself
	// one of the literal entries in the policy's own known-metadata-hostname
	// set, so this still exercises the metadata-specific absolute block —
	// not merely the ordinary link-local private-range block — including
	// that it is refused even with allowPrivateFetches: true.
	//
	// Today this already rejects, but for the wrong reason: nothing in this
	// sandbox listens on 169.254.169.254, so axios fails at the OS socket
	// layer (ECONNREFUSED) after already attempting the connection. That is
	// exactly the gap: on a real cloud VM this address does answer, and an
	// unvalidated POST here would succeed and return live instance metadata.
	// The fix must refuse this before the connection is ever attempted, with
	// the policy's own dedicated message — this assertion is what tells the
	// two apart.
	test("refuses the cloud metadata address as the FlareSolverr endpoint, even with allowPrivateFetches: true", async () => {
		await expect(
			suggestSelectors(
				PERMITTED_TARGET_URL,
				{ enabled: true, serverUrl: "http://169.254.169.254", timeout: 5000 },
				undefined,
				{ allowlist: [], allowPrivateFetches: true },
			),
		).rejects.toThrow(/metadata|blocked/i);
	});
});
