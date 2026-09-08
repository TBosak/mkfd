// TDD slice: p3-flaresolverr-adapter
//
// workers/feed-updater.worker.ts:321 is one of the four call sites the
// brief's table marks as already validating the FlareSolverr endpoint
// before posting to it. These tests are the v2-compatibility half of
// requirement 7 for the scheduled worker flow, plus requirement 3 and
// requirement 1 (the direct axios.post itself must be gone, proved by
// tests/flaresolverr-adapter-static-guard.test.ts).
//
// Spawned as a real Bun `Worker` thread via `new Worker(...)` and driven
// with `worker.postMessage({ command: "start", config })`, matching the
// locked tests/feed-updater-worker-outbound-executor.test.ts exactly — see
// that file's own comment for why this must not be a static/dynamic
// import of the worker module instead.
//
// RUNTIME_DB_PATH is set before spawning so the worker thread initializes
// its sqlite database at an isolated, disposable path, the same isolation
// technique the locked sibling test uses.

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

function runWorkerStart(config: Record<string, unknown>): Promise<{ status: string; metrics?: { errorMessage?: string | null } }> {
	return new Promise((resolve, reject) => {
		const worker = new Worker("./workers/feed-updater.worker.ts", { type: "module" });
		cleanups.push(() => worker.terminate());
		worker.onmessage = (event: MessageEvent) => resolve(event.data);
		worker.onerror = (event: ErrorEvent) => reject(event.error ?? new Error(event.message));
		worker.postMessage({ command: "start", config });
	});
}

const MARKER = "worker-flaresolverr-marker-d419";
const HTML = `<html><body><article><h2 class="title">${MARKER}</h2><a class="link" href="/1">Link</a></article></body></html>`;

function webScrapingConfig(overrides: Record<string, unknown> = {}) {
	return {
		feedId: `worker-flaresolverr-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
		feedName: "Worker FlareSolverr Test",
		feedType: "webScraping",
		refreshTime: 5,
		config: { baseUrl: "http://93.184.216.34" },
		article: {
			iterator: { selector: "article" },
			title: { selector: ".title" },
			link: { selector: ".link", attribute: "href", isRelative: true, baseUrl: "http://93.184.216.34" },
		},
		...overrides,
	};
}

describe("feed-updater.worker — FlareSolverr adapter (requirements 1, 3, 7)", () => {
	test(
		"sanity: a scheduled webScraping run with a permitted endpoint fetches through FlareSolverr",
		async () => {
			process.env.RUNTIME_DB_PATH = "./.tdd-state/_flaresolverr-adapter-worker/sanity.db";
			process.env.OUTBOUND_FETCH_ALLOWLIST = "127.0.0.1";
			const stub = startFlareSolverrStub(() => ({ response: HTML }));

			const message = await runWorkerStart(
				webScrapingConfig({
					flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
				}),
			);

			expect(message.status, JSON.stringify(message)).toBe("done");
			expect(stub.requestCount()).toBe(1);
		},
		20_000,
	);

	test(
		"refuses a blocked (non-allowlisted loopback) FlareSolverr endpoint, without ever contacting it",
		async () => {
			process.env.RUNTIME_DB_PATH = "./.tdd-state/_flaresolverr-adapter-worker/blocked-endpoint.db";
			process.env.OUTBOUND_FETCH_ALLOWLIST = "";
			const stub = startFlareSolverrStub(() => ({ response: HTML }));

			const message = await runWorkerStart(
				webScrapingConfig({
					flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
				}),
			);

			expect(message.status, JSON.stringify(message)).toBe("error");
			expect(stub.requestCount()).toBe(0);
		},
		20_000,
	);

	test(
		"refuses a blocked target (config.baseUrl) even though the FlareSolverr endpoint is permitted, without ever contacting the endpoint (requirement 3)",
		async () => {
			process.env.RUNTIME_DB_PATH = "./.tdd-state/_flaresolverr-adapter-worker/blocked-target.db";
			process.env.OUTBOUND_FETCH_ALLOWLIST = "127.0.0.1";
			const stub = startFlareSolverrStub(() => ({ response: HTML }));

			const message = await runWorkerStart(
				webScrapingConfig({
					config: { baseUrl: "http://10.0.0.5" },
					flaresolverr: { enabled: true, serverUrl: stub.url, timeout: 5000 },
				}),
			);

			expect(message.status, JSON.stringify(message)).toBe("error");
			expect(
				stub.requestCount(),
				"the permitted FlareSolverr endpoint must never be contacted when the worker's own target fails its own, separate validation",
			).toBe(0);
		},
		20_000,
	);
});
