// TDD slice: p3-source-definition-registry
//
// requirement 6 — disabled and unknown types are refused consistently at
// every entry point: create, update, preview, and scheduled execution.
// requirement 5 — protected fields are masked on read (regression guard for
// the property p2-protected-value-aes-gcm established).
//
// create/update/preview are driven through the real route handlers
// (routes/feeds.ts's feedsRouter, routes/preview.ts's previewRouter) via
// Hono's `app.request()` test helper — the same pattern
// tests/service-connectors/service-connectors.test.ts already uses for
// route-level coverage, and the one this brief's own Test-author
// expectations names explicitly ("the feeds route handlers").
//
// Scheduled execution is driven by spawning the real worker thread
// (`new Worker("./workers/feed-updater.worker.ts")`), the same technique
// tests/feed-updater-worker-outbound-executor.test.ts (locked) uses and for
// the same reason: that file is reachable only through this runtime
// path-string Worker call plus an explicit fallow `entry` declaration (see
// tests/fallow-static-analysis-gate.test.ts), so a static/dynamic import of
// the worker module here would defeat that other slice's proof.
//
// Today, create/update/preview already refuse both an unknown feedType and
// "changeDetection" — castFeedFormDataToFeedConfig (utilities/feed-config-
// caster.utility.ts) has no branch for either and throws a message naming
// the exact type. Scheduled execution does not go through the caster at
// all: normalizeLoadedFeedConfig's fallback branch for "stub types and
// unknown" (utilities/feed-config-normalizer.utility.ts:165-170) accepts
// *any* feedType structurally, and the worker's dispatch chain
// (workers/feed-updater.worker.ts) then falls through to the same generic
// "RSS XML could not be generated." message for an unknown type, a typo,
// and the legitimately-stubbed changeDetection alike — exactly the "each
// entry point has its own chain and they can disagree" defect the brief
// names. The worker-refusal tests below are this file's RED evidence; the
// create/update/preview tests are consistency pins proving those three
// already agree with each other today.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { feedsRouter } from "../routes/feeds";
import { previewRouter } from "../routes/preview";
import { castFeedFormDataToFeedConfig } from "../utilities/feed-config-caster.utility";

const ENCRYPTION_KEY = "p3-source-definition-registry-test-key-32chars";
const UNKNOWN_TYPE = "definitely-not-a-real-source-type-8f2c";

// ---------------------------------------------------------------------------
// create / update / preview — consistency pins (already passing today)
// ---------------------------------------------------------------------------

describe("requirement 6 — create (POST /) refuses an unregistered or disabled type before any worker is started", () => {
	async function makeApp() {
		const configsDir = await mkdtemp(join(tmpdir(), "p3-registry-create-"));
		return { app: feedsRouter({ encryptionKey: ENCRYPTION_KEY, configsDir, feedPath: "./public/feeds" }), configsDir };
	}

	test("an unknown feedType is refused with a message naming the type, and no config file is written", async () => {
		const { app, configsDir } = await makeApp();
		try {
			const res = await app.request("/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ feedType: UNKNOWN_TYPE, feedName: "Unknown Type Create", refreshTime: 5 }),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			const message = JSON.stringify(body);
			expect(message).toContain(UNKNOWN_TYPE);
		} finally {
			await rm(configsDir, { recursive: true, force: true });
		}
	});

	test("changeDetection (a registered-but-unimplemented stub type) is refused with a message naming it, not silently accepted as a working feed", async () => {
		const { app, configsDir } = await makeApp();
		try {
			const res = await app.request("/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ feedType: "changeDetection", feedName: "Change Detection Create", refreshTime: 5 }),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(JSON.stringify(body)).toContain("changeDetection");
		} finally {
			await rm(configsDir, { recursive: true, force: true });
		}
	});
});

describe("requirement 6 — update (PUT /api/feeds/:id) refuses an unregistered or disabled type", () => {
	async function makeAppWithExistingFeed() {
		const configsDir = await mkdtemp(join(tmpdir(), "p3-registry-update-"));
		const feedId = "existing-feed-for-update-test";
		const existing = castFeedFormDataToFeedConfig(
			{ feedType: "rest", feedName: "Existing REST Feed", refreshTime: 5, feedUrl: "http://127.0.0.1:1/unreachable" },
			{ feedId, encryptionKey: ENCRYPTION_KEY },
		);
		await writeFile(join(configsDir, `${feedId}.yaml`), yaml.dump(existing), "utf8");
		return { app: feedsRouter({ encryptionKey: ENCRYPTION_KEY, configsDir, feedPath: "./public/feeds" }), configsDir, feedId };
	}

	test("an unknown feedType is refused with a message naming the type; the existing feed's stored config is untouched", async () => {
		const { app, configsDir, feedId } = await makeAppWithExistingFeed();
		try {
			const res = await app.request(`/api/feeds/${feedId}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ feedType: UNKNOWN_TYPE, feedName: "Updated To Unknown", refreshTime: 5 }),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(JSON.stringify(body)).toContain(UNKNOWN_TYPE);

			const getRes = await app.request(`/api/feeds/${feedId}/config`);
			const config = await getRes.json();
			expect(config.feedType).toBe("rest");
			expect(config.feedName).toBe("Existing REST Feed");
		} finally {
			await rm(configsDir, { recursive: true, force: true });
		}
	});

	test("changeDetection is refused with a message naming it", async () => {
		const { app, configsDir, feedId } = await makeAppWithExistingFeed();
		try {
			const res = await app.request(`/api/feeds/${feedId}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ feedType: "changeDetection", feedName: "Updated To ChangeDetection", refreshTime: 5 }),
			});
			expect(res.status).toBe(400);
			expect(JSON.stringify(await res.json())).toContain("changeDetection");
		} finally {
			await rm(configsDir, { recursive: true, force: true });
		}
	});
});

describe("requirement 6 — preview (POST /preview) refuses an unregistered or disabled type", () => {
	function makeApp() {
		return previewRouter({ encryptionKey: ENCRYPTION_KEY });
	}

	test("an unknown feedType is refused with a message naming the type", async () => {
		const app = makeApp();
		const res = await app.request("/preview", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ feedType: UNKNOWN_TYPE, feedName: "Unknown Type Preview", refreshTime: 5 }),
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain(UNKNOWN_TYPE);
	});

	test("changeDetection is refused with a message naming it", async () => {
		const app = makeApp();
		const res = await app.request("/preview", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ feedType: "changeDetection", feedName: "Change Detection Preview", refreshTime: 5 }),
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("changeDetection");
	});
});

// ---------------------------------------------------------------------------
// requirement 5 — protected fields are masked on read (regression guard)
// ---------------------------------------------------------------------------

describe("requirement 5 — GET /api/feeds/:id/config masks protected fields on read", () => {
	test("a protected header value is masked, and its ciphertext never reaches the response body", async () => {
		const configsDir = await mkdtemp(join(tmpdir(), "p3-registry-mask-"));
		try {
			const feedId = "mask-regression-feed";
			const secretToken = "p3-registry-mask-regression-secret-4kD9Lp";
			const cast = castFeedFormDataToFeedConfig(
				{
					feedType: "rest",
					feedName: "Mask Regression Feed",
					refreshTime: 5,
					feedUrl: "http://127.0.0.1:1/unreachable",
					headers: { Authorization: { type: "protected", value: secretToken } },
				},
				{ feedId, encryptionKey: ENCRYPTION_KEY },
			);
			await writeFile(join(configsDir, `${feedId}.yaml`), yaml.dump(cast), "utf8");

			const app = feedsRouter({ encryptionKey: ENCRYPTION_KEY, configsDir, feedPath: "./public/feeds" });
			const res = await app.request(`/api/feeds/${feedId}/config`);
			expect(res.status).toBe(200);
			const config = await res.json();

			expect(config.headers.Authorization).toEqual({ type: "protected", value: "********" });
			const raw = JSON.stringify(config);
			expect(raw).not.toContain(secretToken);
			// A raw AES-256-GCM envelope (utilities/security.utility.ts encrypt())
			// is a JSON object with these three fields; none should reach the
			// masked API response either.
			expect(raw).not.toContain('"iv"');
			expect(raw).not.toContain('"tag"');
			expect(raw).not.toContain('"ct"');
		} finally {
			await rm(configsDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// requirement 6 — scheduled execution (the real worker thread) refuses an
// unregistered or disabled type just as clearly as the three routes above,
// instead of the generic, type-blind fallback it produces today.
// ---------------------------------------------------------------------------

describe("requirement 6 — scheduled execution (the real feed-updater worker) refuses an unregistered or disabled type with a message naming it, not the generic type-blind fallback", () => {
	const cleanups: Array<() => void> = [];
	const originalRuntimeDbPath = process.env.RUNTIME_DB_PATH;

	afterEach(() => {
		process.env.RUNTIME_DB_PATH = originalRuntimeDbPath;
		while (cleanups.length) {
			cleanups.pop()?.();
		}
	});

	function runWorkerStart(config: Record<string, unknown>): Promise<{ status: string; error?: string; metrics?: { errorMessage?: string | null } }> {
		return new Promise((resolvePromise, reject) => {
			const worker = new Worker("./workers/feed-updater.worker.ts", { type: "module" });
			cleanups.push(() => worker.terminate());
			worker.onmessage = (event: MessageEvent) => resolvePromise(event.data);
			worker.onerror = (event: ErrorEvent) => reject(event.error ?? new Error(event.message));
			worker.postMessage({ command: "start", config });
		});
	}

	test(
		"an unknown feedType produces an error message that names the type — not the generic 'RSS XML could not be generated.'",
		async () => {
			process.env.RUNTIME_DB_PATH = `./.tdd-state/_feed-source-registry-worker-and-routes/runtime-unknown-${Date.now()}.db`;

			const message = await runWorkerStart({
				feedId: `worker-refusal-unknown-${Date.now()}`,
				feedName: "Worker Refusal Unknown Type",
				feedType: UNKNOWN_TYPE,
				refreshTime: 5,
			});

			expect(message.status).toBe("error");
			const errorMessage = message.metrics?.errorMessage ?? message.error ?? "";
			expect(
				errorMessage,
				`worker must name the unsupported type '${UNKNOWN_TYPE}' in its refusal, not a generic message; got: ${JSON.stringify(message)}`,
			).toContain(UNKNOWN_TYPE);
		},
		20_000,
	);

	test(
		"changeDetection (registered but unimplemented) produces an error message that names it — not the generic 'RSS XML could not be generated.'",
		async () => {
			process.env.RUNTIME_DB_PATH = `./.tdd-state/_feed-source-registry-worker-and-routes/runtime-changedetection-${Date.now()}.db`;

			const message = await runWorkerStart({
				feedId: `worker-refusal-changedetection-${Date.now()}`,
				feedName: "Worker Refusal ChangeDetection",
				feedType: "changeDetection",
				refreshTime: 5,
				changeDetection: {},
			});

			expect(message.status).toBe("error");
			const errorMessage = message.metrics?.errorMessage ?? message.error ?? "";
			expect(
				errorMessage,
				`worker must name 'changeDetection' in its refusal, not a generic message; got: ${JSON.stringify(message)}`,
			).toContain("changeDetection");
		},
		20_000,
	);

	test(
		"sanity: a real, supported type (filesystem, which needs no network) still reports success through the same worker entry point",
		async () => {
			process.env.RUNTIME_DB_PATH = `./.tdd-state/_feed-source-registry-worker-and-routes/runtime-filesystem-sanity-${Date.now()}.db`;
			const root = await mkdtemp(join(tmpdir(), "p3-registry-worker-fs-sanity-"));
			cleanups.push(() => {
				rm(root, { recursive: true, force: true }).catch(() => {});
			});
			await writeFile(join(root, "note.md"), "# Worker filesystem sanity note", "utf8");
			const originalFilesystemRoot = process.env.FILESYSTEM_FEEDS_ROOT;
			process.env.FILESYSTEM_FEEDS_ROOT = root;
			cleanups.push(() => {
				process.env.FILESYSTEM_FEEDS_ROOT = originalFilesystemRoot;
			});

			const message = await runWorkerStart({
				feedId: `worker-sanity-filesystem-${Date.now()}`,
				feedName: "Worker Sanity Filesystem",
				feedType: "filesystem",
				refreshTime: 5,
				filesystem: {
					rootPath: resolve(root),
					recursive: true,
					include: ["*.md"],
					exclude: [],
					maxItems: 10,
					sortOrder: "filenameAsc",
					dateStrategy: "modifiedTime",
					guidStrategy: "path",
					titleStrategy: "filenameWithoutExtension",
					descriptionStrategy: "none",
				},
			});

			expect(message.status, `expected success; got: ${JSON.stringify(message)}`).toBe("done");
		},
		20_000,
	);
});
