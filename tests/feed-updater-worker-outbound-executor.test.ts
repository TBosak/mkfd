// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for workers/feed-updater.worker.ts. Same shape as
// the preview-generator gap: fetchDataAndUpdateFeed validates its top-level
// `feedUrl` up front, then for "calendar" (and "sitemap"/"graphql")
// delegates to fetchAndBuildCalendarItems, which lets plain axios.get
// follow redirects with axios's own unchecked default behavior (see
// utilities/calendar-feed.utility.ts). A feed URL that passes the initial
// check can still redirect the real fetch to a blocked address, and the
// worker's own real entry point reports success with the leaked content.
//
// This drives the worker exactly the way production does it: spawned as a
// real Bun `Worker` thread via `new Worker("./workers/feed-updater.worker.ts",
// { type: "module" })` and driven with `worker.postMessage({ command:
// "start", config })`, the same call utilities/worker-manager.utility.ts
// makes. Deliberately NOT a static or dynamic `import`/`require` of the
// worker module: tests/fallow-static-analysis-gate.test.ts (a locked test
// from an earlier slice) proves that this exact worker file is reachable
// *only* through this runtime `new Worker(path-string)` call and an
// explicit dead-code-analyzer `entry` declaration — a module-level `import`
// from this test would make the analyzer see it as statically referenced
// and silently defeat that other slice's proof. Spawning a real worker
// thread also happens to be the more faithful way to exercise its
// `self.onmessage` entry point, since that IS the real entry point a
// worker thread is given.
//
// RUNTIME_DB_PATH is set on this process before spawning so the worker
// thread (which inherits the parent's env) initializes its sqlite database
// at an isolated, disposable path under .tdd-state/ rather than the real
// dev database — the same isolation technique
// tests/auth-trust-boundary.test.ts already uses for the same reason.
//
// Both redirect hops are real local HTTP servers on 127.0.0.1/127.0.0.2 —
// loopback addresses that can never leave the host — so this cannot reach
// anything outside the test process regardless of whether the refusal
// happens.

import { afterEach, describe, expect, test } from "bun:test";

const cleanups: Array<() => void> = [];
const originalRuntimeDbPath = process.env.RUNTIME_DB_PATH;
const originalAllowlistEnv = process.env.OUTBOUND_FETCH_ALLOWLIST;

afterEach(() => {
	process.env.RUNTIME_DB_PATH = originalRuntimeDbPath;
	process.env.OUTBOUND_FETCH_ALLOWLIST = originalAllowlistEnv;
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

function startServer(hostname: string, fetchHandler: (req: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname, port: 0, fetch: fetchHandler });
	cleanups.push(() => server.stop(true));
	return { url: `http://${hostname}:${server.port}`, port: server.port };
}

function runWorkerStart(config: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const worker = new Worker("./workers/feed-updater.worker.ts", { type: "module" });
		cleanups.push(() => worker.terminate());
		worker.onmessage = (event: MessageEvent) => resolve(event.data);
		worker.onerror = (event: ErrorEvent) => reject(event.error ?? new Error(event.message));
		worker.postMessage({ command: "start", config });
	});
}

const LEAK_MARKER = "internal-worker-secret-5d90";
const LEAKED_ICS = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:${LEAK_MARKER}\nDTSTART:20301231T000000Z\nEND:VEVENT\nEND:VCALENDAR`;

describe("feed-updater.worker — outbound executor policy for its calendar delegation (requirement 7)", () => {
	test(
		"a calendar feed URL that passes the initial check must not leak content from a redirect to a non-allowlisted address",
		async () => {
			process.env.RUNTIME_DB_PATH = "./.tdd-state/_feed-updater-worker-outbound-executor/runtime.db";
			// Only hop 1's exact address is allowlisted (env-based: the
			// normalized feed config the worker builds does not carry a
			// per-feed allowlist override, so the worker's own global,
			// env-driven allowlist is the mechanism this test controls).
			process.env.OUTBOUND_FETCH_ALLOWLIST = "127.0.0.1";

			let hop2Requests = 0;
			const hop2 = startServer("127.0.0.2", () => {
				hop2Requests++;
				return new Response(LEAKED_ICS);
			});
			const hop1 = startServer("127.0.0.1", () => {
				return new Response(null, {
					status: 302,
					headers: { location: `http://127.0.0.2:${hop2.port}/leak.ics` },
				});
			});

			const config = {
				feedId: `worker-outbound-test-${Date.now()}`,
				feedName: "Worker Outbound Test",
				feedType: "calendar",
				calendar: {
					url: `${hop1.url}/cal.ics`,
					windowDays: 36500,
					includePastEvents: false,
					expandRecurringEvents: false,
					maxEvents: 50,
					sortOrder: "startAsc",
					dateStrategy: "start",
					linkStrategy: "eventUrl",
					includeCanceled: false,
				},
			};

			const message = await runWorkerStart(config);

			// The worker's postMessage payload is summary metrics, not the built
			// feed body, so the meaningful signal here is whether hop 2 — the
			// address only reachable by following an unrevalidated redirect —
			// was ever actually contacted.
			expect(
				hop2Requests,
				`hop 2 must never be reached by an unrevalidated redirect; worker reported ${JSON.stringify(message)}`,
			).toBe(0);
		},
		20_000,
	);
});
