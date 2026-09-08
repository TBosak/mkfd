import { BrowserHarness, mockPatchright } from "./fake-browser";

/**
 * Loaded via `new Worker(..., { preload: [...] })` by
 * tests/browser-adapter-worker.test.ts, which spawns the real worker as its
 * own thread (a fresh module registry `mock.module` in the parent test
 * process cannot reach). `__BROWSER_ADAPTER_TEST_SCENARIO__` is a small JSON
 * object set by the parent test on `process.env` before spawning -- the same
 * "worker thread inherits the parent's env" mechanism
 * tests/feed-updater-worker-outbound-executor.test.ts already relies on for
 * RUNTIME_DB_PATH. No real Chromium process is ever launched inside the
 * worker thread.
 */

interface WorkerTestScenario {
	htmlByUrl?: Record<string, string>;
	redirectChains?: Record<string, string[]>;
}

// Guarded on the scenario env var being present (rather than mocking
// unconditionally) so that tests/browser-adapter-worker.test.ts can also
// import this module by plain static `import` -- purely to give the dead-code
// analyzer a reachability edge to it (see that test file's own comment: a
// file reachable only through a runtime `preload: [...]` string, like this
// one, is invisible to static analysis, the same problem
// workers/feed-updater.worker.ts itself has and solves via `.fallowrc.json`'s
// `entry` array, a production config file outside this slice's tests/-only
// write boundary). That static import must be a harmless no-op in the parent
// test process, where the scenario env var is never set.
const raw = process.env.__BROWSER_ADAPTER_TEST_SCENARIO__;
if (raw) {
	const scenario = JSON.parse(raw) as WorkerTestScenario;

	const harness = new BrowserHarness();
	for (const [url, html] of Object.entries(scenario.htmlByUrl ?? {})) {
		harness.htmlByUrl.set(url, html);
	}
	for (const [url, hops] of Object.entries(scenario.redirectChains ?? {})) {
		harness.redirectChains.set(url, hops);
	}

	mockPatchright(harness);
}
