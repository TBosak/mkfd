/**
 * The one approved way to reach FlareSolverr.
 *
 * Seven direct `axios.post` calls used to do this across six files, each
 * rebuilding the payload by hand — and the duplication had already produced
 * inconsistent security behaviour. Four sites validated the FlareSolverr
 * endpoint before posting to it; three did not, and those three took
 * `flaresolverr.serverUrl` — a value the *feed author* supplies in config —
 * and posted to it unchecked. Pointing a feed's "FlareSolverr server" at a
 * cloud metadata address or an internal admin endpoint would have had the app
 * POST there, from inside the network, on a schedule.
 *
 * An adapter makes the check unskippable rather than remembered.
 *
 * Lives under `lib/` for the same reason `pinned-request.ts` does: the locked
 * architecture gate scans `routes/`, `utilities/`, `workers/` and `node/` and
 * refuses direct network primitives there. Keeping the call outside those
 * directories is what lets that rule stay absolute inside them.
 */

import { assertAndResolveOutboundTarget } from "../../utilities/outbound-fetch-policy.utility";
import type { OutboundFetchPolicyOptions } from "../../utilities/outbound-fetch-policy.utility";
import { redact } from "../../utilities/log-redaction.utility";
import { requestPinnedWithConfig } from "./pinned-request";

export interface FlareSolverrCookie {
	name: string;
	value: string;
}

export interface FlareSolverrRequest {
	/** Where FlareSolverr itself lives. Feed-author supplied, so validated. */
	serverUrl: string;
	/** The page FlareSolverr is asked to fetch. Also feed-author supplied. */
	targetUrl: string;
	/** What the config asked for. Bounded by the total budget below. */
	maxTimeoutMs?: number;
	cookies?: FlareSolverrCookie[];
	policyOptions: OutboundFetchPolicyOptions;
	/** Whole-operation budget, from the same feed-run timeout ordinary fetches use. */
	budgetMs: number;
}

export interface FlareSolverrResult {
	/** The solved page HTML. */
	html: string;
	/** FlareSolverr's own reported status for the solved page. */
	status: number;
}

/** Trims a trailing slash so `${base}/v1` never becomes `//v1`. */
function normalizeBase(url: string): string {
	return url.replace(/\/+$/, "");
}

/**
 * Posts a `request.get` to FlareSolverr and returns the solved page.
 *
 * Order matters: the **target** is validated first, so a request with a
 * blocked target never contacts the FlareSolverr endpoint at all. The two are
 * separate checks against separately attacker-influenced values, and
 * collapsing them would let one stand in for the other.
 */
export async function solveWithFlareSolverr(request: FlareSolverrRequest): Promise<FlareSolverrResult> {
	const base = normalizeBase(request.serverUrl);
	const endpoint = `${base}/v1`;

	// Target first — see above.
	await assertAndResolveOutboundTarget(request.targetUrl, request.policyOptions);
	const validatedEndpoint = await assertAndResolveOutboundTarget(endpoint, request.policyOptions);

	// The configured timeout is a request, not a grant: a hostile-large
	// `maxTimeout` must not extend the operation, so the budget caps it.
	const budgetMs = Math.max(1, request.budgetMs);
	const maxTimeoutMs = Math.min(request.maxTimeoutMs ?? budgetMs, budgetMs);

	const payload: Record<string, unknown> = {
		cmd: "request.get",
		url: request.targetUrl,
		maxTimeout: maxTimeoutMs,
	};
	if (request.cookies?.length) {
		payload.cookies = request.cookies.map((c) => ({ name: c.name, value: c.value }));
	}

	let response: Awaited<ReturnType<typeof requestPinnedWithConfig>>;
	try {
		response = await requestPinnedWithConfig(
			endpoint,
			validatedEndpoint.address,
			{
				method: "post",
				data: payload,
				headers: { "Content-Type": "application/json" },
				timeout: budgetMs,
				validateStatus: () => true,
			},
			Date.now() + budgetMs,
		);
	} catch (error) {
		// The endpoint and the cookies in the payload are both sensitive; a
		// transport error message can carry either.
		throw new Error(
			`FlareSolverr request failed: ${JSON.stringify(redact({ message: error instanceof Error ? error.message : String(error) }))}`,
		);
	}

	// A redirect from the FlareSolverr endpoint is refused rather than
	// followed. Following it would reach a destination that never passed the
	// policy, and there is no legitimate reason for a solver API to redirect.
	if (response.status >= 300 && response.status < 400) {
		throw new Error(
			`FlareSolverr endpoint returned a ${response.status} redirect; refusing to follow it to an unvalidated destination.`,
		);
	}

	const solution = (response.data as { solution?: { response?: unknown; status?: unknown }; message?: unknown } | undefined)
		?.solution;
	const solvedStatus = typeof solution?.status === "number" ? solution.status : undefined;

	if (typeof solution?.response !== "string" || solvedStatus !== 200) {
		const message = (response.data as { message?: unknown } | undefined)?.message;
		throw new Error(
			`FlareSolverr did not solve the request: ${JSON.stringify(redact({ message, solvedStatus }))}`,
		);
	}

	return { html: solution.response, status: solvedStatus };
}
