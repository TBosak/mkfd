// TDD slice: p3-browser-adapter
//
// workers/feed-updater.worker.ts:333 is the scheduled-run browser call site
// the brief names for migration to lib/outbound/browser-adapter.ts.
//
// Spawned as a real Bun `Worker` thread via `new Worker(...)` and driven
// with `worker.postMessage({ command: "start", config })`, matching the
// locked tests/feed-updater-worker-outbound-executor.test.ts exactly (see
// that file's own comment: a static/dynamic import of the worker module
// would defeat a different, locked dead-code-analyzer proof).
//
// A real worker thread has its own module registry, so `mock.module` called
// from this file's (parent) thread cannot reach it -- unlike
// tests/browser-adapter-data-handler.test.ts and
// tests/browser-adapter-preview-generator.test.ts, which run in-process.
// Instead this file passes a `preload` script
// (tests/helpers/browser-adapter-worker-preload.ts) that mocks "patchright"
// *inside* the worker thread, driven by a small per-test scenario (a
// url->html map, and optionally a redirect-chain map) smuggled through an
// environment variable the worker thread inherits from this process -- the
// same inheritance mechanism the locked sibling test already relies on for
// RUNTIME_DB_PATH. No real Chromium process is ever launched.
//
// Deeper interception mechanics (subresource abort, redirect revalidation,
// budget-derived launch timeout, cookie/header threading) are exhaustively
// covered against the adapter directly in tests/browser-adapter.test.ts and,
// for the preview call site, tests/browser-adapter-preview-generator.test.ts
// -- both run in-process, where per-call observability is straightforward.
// This file's job is narrower and specific to the worker: prove the
// scheduled-run entry point is actually wired to the (real) adapter rather
// than the old unvalidated direct call, using the only channel a real
// worker thread's `self.postMessage` result exposes to the parent --
// `status`/`metrics` -- which is exactly the technique
// tests/flaresolverr-adapter-worker.test.ts already uses successfully for
// the same reason.

import { afterEach, describe, expect, test } from "bun:test";
// Side-effect only: gives the dead-code analyzer a static reachability edge
// to the preload script below, which is otherwise reached only through the
// runtime `preload: [...]` string passed to `new Worker(...)`. The module is
// a harmless no-op here -- it only mocks "patchright" when
// __BROWSER_ADAPTER_TEST_SCENARIO__ is set, which never happens in this
// (parent) process. See that file's own comment for the full rationale.
import "./helpers/browser-adapter-worker-preload";

const cleanups: Array<() => void> = [];
const originalRuntimeDbPath = process.env.RUNTIME_DB_PATH;
const originalScenarioEnv = process.env.__BROWSER_ADAPTER_TEST_SCENARIO__;

afterEach(() => {
	process.env.RUNTIME_DB_PATH = originalRuntimeDbPath;
	process.env.__BROWSER_ADAPTER_TEST_SCENARIO__ = originalScenarioEnv;
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

interface WorkerResultMessage {
	status: string;
	feedId?: string;
	error?: string;
	metrics?: { itemCount?: number | null; errorMessage?: string | null };
}

function runWorkerStart(
	config: Record<string, unknown>,
): Promise<WorkerResultMessage> {
	return new Promise((resolve, reject) => {
		const worker = new Worker("./workers/feed-updater.worker.ts", {
			type: "module",
			preload: ["./tests/helpers/browser-adapter-worker-preload.ts"],
		});
		cleanups.push(() => worker.terminate());
		worker.onmessage = (event: MessageEvent) =>
			resolve(event.data as WorkerResultMessage);
		worker.onerror = (event: ErrorEvent) =>
			reject(event.error ?? new Error(event.message));
		worker.postMessage({ command: "start", config });
	});
}

const MARKER = "worker-browser-marker-77e2";
const BASE_URL = "http://93.184.216.34";
const HTML = `<html><body><article><h2 class="title">${MARKER}</h2><a class="link" href="/1">Link</a></article></body></html>`;

function webScrapingConfig(overrides: Record<string, unknown> = {}) {
	return {
		feedId: `worker-browser-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
		feedName: "Worker Browser Test",
		feedType: "webScraping",
		refreshTime: 5,
		advanced: true,
		config: { baseUrl: BASE_URL },
		article: {
			iterator: { selector: "article" },
			title: { selector: ".title" },
			link: {
				selector: ".link",
				attribute: "href",
				isRelative: true,
				baseUrl: BASE_URL,
			},
		},
		...overrides,
	};
}

const PRIVATE_REDIRECT_TARGET = "http://10.0.0.5/redirected";

describe("feed-updater.worker — browser adapter (requirements 1, 4, 6, migration)", () => {
	test("sanity: a scheduled advanced (browser) run with a permitted baseUrl completes and builds a real item", async () => {
		process.env.RUNTIME_DB_PATH =
			"./.tdd-state/_browser-adapter-worker/sanity.db";
		process.env.__BROWSER_ADAPTER_TEST_SCENARIO__ = JSON.stringify({
			htmlByUrl: { [BASE_URL]: HTML },
		});

		const message = await runWorkerStart(webScrapingConfig());

		expect(message.status, JSON.stringify(message)).toBe("done");
		expect(message.metrics?.itemCount).toBe(1);
	}, 20_000);

	// A directly-blocked baseUrl is already caught by fetchDataAndUpdateFeed's
	// own top-level `assertOutboundFetchAllowed(feedUrl, ...)` pre-check
	// (workers/feed-updater.worker.ts, before any feedType branch runs) --
	// re-proving that would not demonstrate anything this slice adds. What
	// that one-shot, one-time check cannot catch is a redirect the browser
	// follows *after* it already passed: the same gap
	// tests/browser-adapter-preview-generator.test.ts proves for the preview
	// call site.
	test("refuses a redirect from the permitted baseUrl to a private address -- fails the run instead of silently succeeding with unvalidated (redirected) content", async () => {
		process.env.RUNTIME_DB_PATH =
			"./.tdd-state/_browser-adapter-worker/redirect-blocked.db";
		process.env.__BROWSER_ADAPTER_TEST_SCENARIO__ = JSON.stringify({
			redirectChains: { [BASE_URL]: [BASE_URL, PRIVATE_REDIRECT_TARGET] },
		});

		const message = await runWorkerStart(webScrapingConfig());

		expect(message.status, JSON.stringify(message)).toBe("error");
	}, 20_000);
});
