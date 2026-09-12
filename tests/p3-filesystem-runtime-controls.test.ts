// TDD slice: p3-filesystem-runtime-controls.
//
// This suite deliberately uses caller-owned temporary directories and SQLite
// files. It never writes feed-state/filesystem or data/runtime.db from the
// checkout; narrow before/after assertions prove those paths remain unchanged.
//
// Behavior-level seams requested from the implementation (names are kept
// stable so the RED is a missing behavior, not an import/harness failure):
//
// - `normalizeFilesystemFeedConfig(input)` returns a bounded config and throws
//   a typed, sanitized validation error for invalid numeric/pattern values.
// - `authorizeFilesystemFeedRoot(path, approvedRoots)` canonicalizes existing
//   directories and rejects files, missing paths, lexical siblings, `..`, and
//   canonical escapes. Save-time and run-time callers may wrap this operation
//   differently; these tests observe its result, not its implementation.
// - `scanFilesystemFeed(config, approvedRoot, feedId, options)` accepts
//   caller-owned state and deterministic controls (`clock`, `signal`, a
//   monotonic `now`, and filesystem-operation seams where a path swap cannot be
//   made reliably by the host). Equivalent scanner wrappers are acceptable if
//   they preserve these observations.
// - `saveFilesystemFeedConfig(id, config, { configDir, approvedRoots })` is
//   the config persistence boundary. It validates/canonicalizes the root
//   before creating or replacing YAML and leaves a prior YAML unchanged on
//   failure.
// - `createFilesystemStateStore(sqlite, { legacyDir, clock, onCommit })` exposes
//   `read(feedId)` and `migrateLegacy()` and is the state boundary used by the
//   scanner. `onCommit` is a deterministic test seam invoked while a complete
//   scan transaction is open, allowing an independent connection to prove it
//   sees the old complete snapshot rather than a partial write. Reads return
//   relative path, stable id, first/last-seen timestamps, last modified time,
//   size, and optional content hash.
// - `options.fs.onRead(kind, path, requestedBytes)` is an optional observation
//   seam used to prove sidecar reads do not request bytes beyond their ceiling.
//
// No private helper, SQL builder, traversal algorithm, warning prose, or
// database library is prescribed by this suite.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as analyticsDb from "../lib/analytics/db";
import * as analyticsSchema from "../lib/analytics/schema";
import * as configManager from "../utilities/config-manager.utility";
import * as filesystem from "../utilities/filesystem-feed.utility";

const MIGRATIONS_DIR = join(
	resolve(import.meta.dir, ".."),
	"drizzle",
	"migrations",
);
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

type BaseConfig = Parameters<typeof filesystem.scanFilesystemFeed>[0];
type ScanOptions = {
	clock?: () => Date;
	now?: () => number;
	signal?: AbortSignal;
	stateStore?: unknown;
	stateDir?: string;
	fs?: Record<string, unknown>;
	limits?: Record<string, number>;
};

type ScanItem = {
	relativePath?: string;
	filename?: string;
	title?: string;
	description?: string;
	publicUrl?: string;
	guid?: string;
};
type ScanLike = {
	items: ScanItem[];
	warnings: unknown[];
	stats: Record<string, number>;
};
type StateRow = {
	relativePath: string;
	stableId: string;
	firstSeenAt: string;
	lastSeenAt: string;
	lastModifiedAt: string;
	sizeBytes: number;
};
type StateStore = {
	read: (feedId: string) => Promise<StateRow[]>;
	migrateLegacy: () => Promise<Record<string, unknown>>;
};
type StateStoreOptions = {
	legacyDir?: string;
	clock?: () => Date;
	onCommit?: () => Promise<void>;
};

// Bun may execute independent describe blocks concurrently. Fixtures are
// unique and intentionally left for the OS temp-directory lifecycle so one
// test's cleanup can never race another test's scan.

async function fixture(label: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), `mkfd-p3-${label}-`));
	return path;
}

function requireExport<T extends (...args: never[]) => unknown>(
	moduleValue: object,
	name: string,
): T {
	const value = (moduleValue as Record<string, unknown>)[name];
	if (typeof value !== "function")
		throw new Error(
			`Missing required filesystem runtime behavior: export ${name}()`,
		);
	return value as T;
}

function baseConfig(
	rootPath: string,
	overrides: Partial<BaseConfig> = {},
): BaseConfig {
	return {
		rootPath,
		recursive: true,
		include: [],
		exclude: [],
		maxItems: 100,
		sortOrder: "filenameAsc",
		dateStrategy: "modifiedTime",
		guidStrategy: "firstSeenId",
		titleStrategy: "filenameWithoutExtension",
		descriptionStrategy: "textPreview",
		...overrides,
	};
}

function codeOf(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error)
		return String((error as { code: unknown }).code);
	if (typeof error === "object" && error !== null && "error" in error) {
		const nested = (error as { error: unknown }).error;
		if (typeof nested === "object" && nested !== null && "code" in nested)
			return String((nested as { code: unknown }).code);
	}
	return "";
}

function safeErrorProjection(error: unknown): string {
	if (error instanceof Error) {
		return JSON.stringify({
			string: String(error),
			message: error.message,
			code: codeOf(error),
			details: (error as Error & { details?: unknown }).details,
			counters: (error as Error & { counters?: unknown }).counters,
		});
	}
	return JSON.stringify({ string: String(error), code: codeOf(error), error });
}

function expectTypedFailure(
	promise: Promise<unknown>,
	category: RegExp,
	forbidden: string[] = [],
): Promise<void> {
	return (async () => {
		let error: unknown;
		try {
			await promise;
		} catch (caught) {
			error = caught;
		}
		const code = codeOf(error);
		expect(code.length).toBeGreaterThan(0);
		expect(code).toMatch(category);
		const projection = safeErrorProjection(error);
		expect(projection).not.toMatch(/stack|enoent|eacces/i);
		for (const secret of forbidden) expect(projection).not.toContain(secret);
	})();
}

const scanImpl = filesystem.scanFilesystemFeed as unknown as (
	config: BaseConfig,
	root: string,
	feedId: string,
	options?: ScanOptions,
) => Promise<ScanLike>;

async function scan(
	config: BaseConfig,
	root: string,
	feedId: string,
	options?: ScanOptions,
): Promise<ScanLike> {
	// The pre-slice scanner writes legacy JSON unconditionally. Keep the RED
	// run E5-clean until the managed state boundary exists; once this required
	// behavior is present, the call below exercises the real scanner.
	requireExport(analyticsDb, "createFilesystemStateStore");
	const checkoutDbPath = join(
		resolve(import.meta.dir, ".."),
		"data",
		"runtime.db",
	);
	const checkoutDbBefore = existsSync(checkoutDbPath)
		? await readFile(checkoutDbPath)
		: undefined;
	const checkoutJsonPath = join(
		resolve(import.meta.dir, ".."),
		"feed-state",
		"filesystem",
		`${feedId}.json`,
	);
	const checkoutJsonBefore = existsSync(checkoutJsonPath)
		? await readFile(checkoutJsonPath)
		: undefined;
	const callerJsonPath = join(root, ".test-state", `${feedId}.json`);
	const callerJsonBefore = existsSync(callerJsonPath)
		? await readFile(callerJsonPath)
		: undefined;
	let temporaryDb: Database | undefined;
	let temporaryDbDir: string | undefined;
	let stateStore = options?.stateStore;
	if (!stateStore) {
		temporaryDbDir = await mkdtemp(join(tmpdir(), "mkfd-p3-state-"));
		const temporaryDbPath = join(temporaryDbDir, "runtime.db");
		temporaryDb = openStateDb(temporaryDbPath);
		stateStore = createStateStore(temporaryDb);
	}
	try {
		return await scanImpl(config, root, feedId, {
			stateDir: join(root, ".test-state"),
			stateStore,
			...options,
		});
	} finally {
		temporaryDb?.close();
		if (temporaryDbDir)
			await rm(temporaryDbDir, { recursive: true, force: true });
		const checkoutDbAfter = existsSync(checkoutDbPath)
			? await readFile(checkoutDbPath)
			: undefined;
		expect(checkoutDbAfter).toEqual(checkoutDbBefore);
		const checkoutJsonAfter = existsSync(checkoutJsonPath)
			? await readFile(checkoutJsonPath)
			: undefined;
		expect(checkoutJsonAfter).toEqual(checkoutJsonBefore);
		const callerJsonAfter = existsSync(callerJsonPath)
			? await readFile(callerJsonPath)
			: undefined;
		expect(callerJsonAfter).toEqual(callerJsonBefore);
	}
}

function openStateDb(path: string): Database {
	const sqlite = new Database(path);
	const db = drizzle(sqlite, { schema: analyticsSchema });
	migrate(db, { migrationsFolder: MIGRATIONS_DIR });
	return sqlite;
}

function createStateStore(
	sqlite: Database,
	options: StateStoreOptions = {},
): StateStore {
	const factory = requireExport<
		(db: Database, opts?: StateStoreOptions) => StateStore
	>(analyticsDb, "createFilesystemStateStore");
	return factory(sqlite, options);
}

function migrationCount(result: Record<string, unknown>): number | undefined {
	for (const [key, value] of Object.entries(result)) {
		if (/(?:import|insert|copy|migrat)/i.test(key) && typeof value === "number")
			return value;
	}
	return undefined;
}

describe.serial("filesystem policy and canonical authorization", () => {
	test("A1/A13: config persistence authorizes roots before writing or replacing YAML", async () => {
		const root = await fixture("save-boundary");
		const configDir = join(root, "configs");
		const approved = join(root, "approved");
		const outside = join(root, "outside");
		const file = join(approved, "not-a-directory.md");
		await mkdir(configDir);
		await mkdir(approved);
		await mkdir(outside);
		await writeFile(file, "file", "utf8");
		const saveModule =
			typeof (configManager as Record<string, unknown>)
				.saveFilesystemFeedConfig === "function"
				? configManager
				: filesystem;
		const save = requireExport<
			(
				id: string,
				config: unknown,
				options: { configDir: string; approvedRoots: string[] },
			) => Promise<void>
		>(saveModule, "saveFilesystemFeedConfig");
		const makeConfig = (rootPath: string) => ({
			feedId: "save-boundary",
			feedName: "Save boundary",
			feedType: "filesystem",
			filesystem: baseConfig(rootPath),
		});
		const options = { configDir, approvedRoots: [approved] };
		await save("save-boundary", makeConfig(approved), options);
		const yamlPath = join(configDir, "save-boundary.yaml");
		const original = await readFile(yamlPath, "utf8");
		for (const rootPath of [join(root, "missing"), outside, file]) {
			await expectTypedFailure(
				Promise.resolve().then(() =>
					save("save-boundary", makeConfig(rootPath), options),
				),
				/AUTH|ROOT|DIRECTORY|MISSING|OUTSIDE/i,
				[rootPath],
			);
			expect(await readFile(yamlPath, "utf8")).toBe(original);
		}
	});

	test("A1/I3: save/run authorization uses canonical existing directories, not lexical prefixes", async () => {
		const root = await fixture("auth");
		const approved = join(root, "approved");
		const sibling = join(root, "approved-sibling");
		const file = join(approved, "file.md");
		await mkdir(approved);
		await mkdir(sibling);
		const outside = join(root, "outside");
		await mkdir(outside);
		await writeFile(file, "x", "utf8");
		await symlink(outside, join(approved, "root-link"), "dir");
		const authorize = requireExport<
			(path: string, roots: string | string[]) => Promise<string> | string
		>(filesystem, "authorizeFilesystemFeedRoot");
		await expect(Promise.resolve(authorize(approved, approved))).resolves.toBe(
			approved,
		);
		await expectTypedFailure(
			Promise.resolve().then(() =>
				authorize(join(approved, "root-link"), approved),
			),
			/AUTH|ROOT|OUTSIDE|SYMLINK/i,
		);
		await expectTypedFailure(
			Promise.resolve().then(() => authorize(sibling, approved)),
			/AUTH|ROOT|OUTSIDE/i,
		);
		await expectTypedFailure(
			Promise.resolve().then(() =>
				authorize(join(approved, "missing"), approved),
			),
			/AUTH|ROOT|MISSING|NOT_FOUND/i,
		);
		await expectTypedFailure(
			Promise.resolve().then(() => authorize(file, approved)),
			/AUTH|ROOT|DIRECTORY/i,
		);
		await expectTypedFailure(
			Promise.resolve().then(() =>
				authorize(join(approved, "..", "approved-sibling"), approved),
			),
			/AUTH|ROOT|OUTSIDE/i,
		);
	});

	test("A6/E1: maxItems and include/exclude patterns are bounded in UTF-8 bytes", () => {
		const normalize = requireExport<(config: unknown) => BaseConfig>(
			filesystem,
			"normalizeFilesystemFeedConfig",
		);
		const normalized = normalize(
			baseConfig("/tmp/feed", {
				maxItems: 50_000,
				include: ["*.md"],
				exclude: ["private/**"],
			}),
		);
		expect(normalized.maxItems).toBe(10_000);
		expect(
			normalize(baseConfig("/tmp/feed", { maxItems: 10_000 })).maxItems,
		).toBe(10_000);
		expect(
			normalize(baseConfig("/tmp/feed", { maxItems: 10_001 })).maxItems,
		).toBe(10_000);
		for (const maxItems of [
			0,
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"20",
		]) {
			expect(() =>
				normalize(baseConfig("/tmp/feed", { maxItems: maxItems as never })),
			).toThrow();
		}
		for (const field of ["include", "exclude"] as const) {
			for (const invalid of [null, "*.md", 42, { pattern: "*.md" }]) {
				expect(() =>
					normalize(baseConfig("/tmp/feed", { [field]: invalid as never })),
				).toThrow();
			}
			const exactCount = Array.from(
				{ length: 100 },
				(_, index) => `p-${index}`,
			);
			expect(
				normalize(baseConfig("/tmp/feed", { [field]: exactCount }))[field],
			).toHaveLength(100);
			expect(() =>
				normalize(
					baseConfig("/tmp/feed", {
						[field]: Array.from({ length: 101 }, () => "*.md"),
					}),
				),
			).toThrow();
			expect(() =>
				normalize(baseConfig("/tmp/feed", { [field]: [42 as never] })),
			).toThrow();
			expect(() =>
				normalize(baseConfig("/tmp/feed", { [field]: ["é".repeat(200)] })),
			).toThrow();
			expect(
				normalize(baseConfig("/tmp/feed", { [field]: ["é".repeat(128)] }))[
					field
				],
			).toHaveLength(1);
			expect(() =>
				normalize(
					baseConfig("/tmp/feed", { [field]: [`${"é".repeat(128)}a`] }),
				),
			).toThrow();
			expect(() =>
				normalize(baseConfig("/tmp/feed", { [field]: [""] })),
			).toThrow();
		}
	});
});

describe.serial("bounded traversal, authorization, and safe reads", () => {
	test("A2/E3: symlink escapes are never read and deterministic path swaps fail closed", async () => {
		const root = await fixture("symlink");
		const approved = join(root, "approved");
		const outside = join(root, "outside");
		await mkdir(approved);
		await mkdir(outside);
		await writeFile(join(outside, "secret.md"), "must-not-be-read", "utf8");
		await writeFile(join(approved, "safe.md"), "safe", "utf8");
		await symlink(outside, join(approved, "escape"), "dir");
		const result = await scan(baseConfig(approved), approved, "symlink-test");
		expect(result.items.map((item) => item.relativePath)).toEqual(["safe.md"]);
		expect(JSON.stringify(result)).not.toContain("must-not-be-read");
		await expectTypedFailure(
			scan(baseConfig(approved), approved, "swap-test-2", {
				fs: {
					beforeOpen: async () => {
						throw Object.assign(new Error("outside race"), {
							code: "FILESYSTEM_RACE",
						});
					},
				},
			}),
			/RACE|AUTH|UNSAFE/i,
		);
	});

	test("A3/E1: exact ceilings are allowed and the first excess depth/entry/match aborts", async () => {
		const root = await fixture("traversal-limits");
		const exactRoot = join(root, "exact");
		const overRoot = join(root, "over");
		const entryExactRoot = join(root, "entry-exact");
		const entryOverRoot = join(root, "entry-over");
		const matchExactRoot = join(root, "match-exact");
		const matchOverRoot = join(root, "match-over");
		await mkdir(exactRoot, { recursive: true });
		await mkdir(overRoot, { recursive: true });
		await mkdir(entryExactRoot, { recursive: true });
		await mkdir(entryOverRoot, { recursive: true });
		await mkdir(matchExactRoot, { recursive: true });
		await mkdir(matchOverRoot, { recursive: true });
		const deep = Array.from({ length: 32 }, (_, index) => `d${index}`).join(
			"/",
		);
		await mkdir(join(exactRoot, deep), { recursive: true });
		await writeFile(join(exactRoot, deep, "at-limit.md"), "ok", "utf8");
		await mkdir(join(overRoot, deep, "over"), { recursive: true });
		await writeFile(join(overRoot, deep, "over", "too-deep.md"), "no", "utf8");
		await writeFile(join(matchExactRoot, "one.md"), "one", "utf8");
		await writeFile(join(matchOverRoot, "one.md"), "one", "utf8");
		await writeFile(join(matchOverRoot, "two.md"), "two", "utf8");
		await writeFile(join(entryExactRoot, "one.md"), "one", "utf8");
		await writeFile(join(entryOverRoot, "one.md"), "one", "utf8");
		await writeFile(join(entryOverRoot, "two.md"), "two", "utf8");
		const exact = await scan(baseConfig(exactRoot), exactRoot, "depth-exact", {
			limits: { maxDepth: 32 },
		});
		expect(
			exact.items.some((item) => item.relativePath?.endsWith("at-limit.md")),
		).toBe(true);
		await expectTypedFailure(
			scan(baseConfig(overRoot), overRoot, "depth-over", {
				limits: { maxDepth: 32 },
			}),
			/DEPTH|LIMIT/i,
		);
		const entriesExact = await scan(
			baseConfig(entryExactRoot),
			entryExactRoot,
			"entries-exact-ok",
			{
				limits: { maxVisitedEntries: 1 },
			},
		);
		expect(entriesExact.items.length).toBe(1);
		await expectTypedFailure(
			scan(baseConfig(entryOverRoot), entryOverRoot, "entries-over", {
				limits: { maxVisitedEntries: 1 },
			}),
			/ENTRY|VISIT|LIMIT/i,
		);
		const matchesExact = await scan(
			baseConfig(matchExactRoot),
			matchExactRoot,
			"matches-exact",
			{
				limits: { maxMatchedFiles: 1 },
			},
		);
		expect(matchesExact.items).toHaveLength(1);
		await expectTypedFailure(
			scan(baseConfig(matchOverRoot), matchOverRoot, "matches-over", {
				limits: { maxMatchedFiles: 1 },
			}),
			/MATCH|LIMIT/i,
		);
	});

	test("A3/A5/E1: total bytes, per-file bytes, configured lower limits, extraction output, and unsupported extensions are bounded", async () => {
		const root = await fixture("byte-limits");
		const exactTotal = join(root, "total-exact");
		const overTotal = join(root, "total-over");
		const exactFile = join(root, "file-exact");
		const overFile = join(root, "file-over");
		const extraction = join(root, "extraction");
		const hardCap = join(root, "hard-cap");
		const lowerConfig = join(root, "lower-config");
		await Promise.all(
			[
				exactTotal,
				overTotal,
				exactFile,
				overFile,
				extraction,
				hardCap,
				lowerConfig,
			].map((path) => mkdir(path)),
		);
		await writeFile(join(exactTotal, "exact.md"), "1234", "utf8");
		await writeFile(join(overTotal, "over.md"), "12345", "utf8");
		await writeFile(join(exactFile, "exact.md"), "1234", "utf8");
		await writeFile(join(overFile, "over.md"), "12345", "utf8");
		await writeFile(join(extraction, "large.md"), "x".repeat(20_001), "utf8");
		await writeFile(
			join(extraction, "unsupported.bin"),
			"x".repeat(20_001),
			"utf8",
		);
		await writeFile(
			join(hardCap, "too-large.md"),
			"x".repeat(5 * 1024 * 1024 + 1),
			"utf8",
		);
		await writeFile(join(lowerConfig, "small.md"), "x".repeat(20), "utf8");
		const contentHashConfig = (rootPath: string) =>
			baseConfig(rootPath, { guidStrategy: "contentHash" });
		const totalExact = await scan(
			contentHashConfig(exactTotal),
			exactTotal,
			"total-exact",
			{
				limits: { maxTotalBytes: 4 },
			},
		);
		expect(totalExact.items).toHaveLength(1);
		await expectTypedFailure(
			scan(contentHashConfig(overTotal), overTotal, "total-over", {
				limits: { maxTotalBytes: 4 },
			}),
			/BYTES|TOTAL|LIMIT/i,
		);
		const fileExact = await scan(
			contentHashConfig(exactFile),
			exactFile,
			"file-exact",
			{
				limits: { maxFileBytes: 4, maxTotalBytes: MAX_SCAN_BYTES },
			},
		);
		expect(fileExact.items).toHaveLength(1);
		await expectTypedFailure(
			scan(contentHashConfig(overFile), overFile, "file-over", {
				limits: { maxFileBytes: 4, maxTotalBytes: MAX_SCAN_BYTES },
			}),
			/BYTES|FILE|LIMIT/i,
		);
		const bounded = await scan(
			baseConfig(extraction, {
				descriptionStrategy: "textPreview",
				extraction: {
					enabled: true,
					maxCharacters: 20_001,
					maxFileSizeBytes: 6 * 1024 * 1024,
					supportedExtensions: ["md"],
				},
			}),
			extraction,
			"extraction-cap",
			{
				limits: {
					maxExtractionCharacters: 20_000,
					maxFileBytes: 5 * 1024 * 1024,
					maxTotalBytes: MAX_SCAN_BYTES,
				},
			},
		);
		expect(
			String(
				bounded.items.find((item) => item.filename === "large.md")
					?.description ?? "",
			).length,
		).toBe(20_000);
		const unsupported = bounded.items.find(
			(item) => item.filename === "unsupported.bin",
		);
		expect(unsupported?.description).toBeUndefined();
		await expectTypedFailure(
			scan(
				baseConfig(hardCap, {
					descriptionStrategy: "textPreview",
					extraction: {
						enabled: true,
						maxCharacters: 20_001,
						maxFileSizeBytes: 6 * 1024 * 1024,
						supportedExtensions: ["md"],
					},
				}),
				hardCap,
				"configured-file-over",
				{ limits: { maxFileBytes: 5 * 1024 * 1024 } },
			),
			/BYTES|FILE|LIMIT/i,
		);
		const lowerCharacters = await scan(
			baseConfig(lowerConfig, {
				descriptionStrategy: "textPreview",
				extraction: {
					enabled: true,
					maxCharacters: 7,
					maxFileSizeBytes: 1000,
					supportedExtensions: ["md"],
				},
			}),
			lowerConfig,
			"lower-characters",
		);
		expect(lowerCharacters.items[0]?.description).toHaveLength(7);
		const lowerFileSize = await scan(
			baseConfig(lowerConfig, {
				descriptionStrategy: "textPreview",
				extraction: {
					enabled: true,
					maxCharacters: 20_000,
					maxFileSizeBytes: 4,
					supportedExtensions: ["md"],
				},
			}),
			lowerConfig,
			"lower-file-size",
		);
		expect(lowerFileSize.items[0]?.description).toBeUndefined();
		const normalize = requireExport<(config: unknown) => BaseConfig>(
			filesystem,
			"normalizeFilesystemFeedConfig",
		);
		for (const key of ["maxCharacters", "maxFileSizeBytes"] as const) {
			for (const value of [
				0,
				-1,
				1.5,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				"100",
			]) {
				expect(() =>
					normalize(
						baseConfig(lowerConfig, {
							extraction: {
								enabled: true,
								maxCharacters: 10,
								maxFileSizeBytes: 10,
								supportedExtensions: ["md"],
								[key]: value as never,
							},
						}),
					),
				).toThrow();
			}
		}
	});

	test("A4/E1: sidecars enforce bytes/depth/nodes/object/prototype limits and preserve valid neighbors", async () => {
		const root = await fixture("sidecars");
		const approved = join(root, "approved");
		await mkdir(approved);
		const nested = (depth: number): Record<string, unknown> => {
			let value: Record<string, unknown> = { title: `depth-${depth}` };
			for (let index = 1; index < depth; index += 1) value = { child: value };
			return value;
		};
		const keyed = (count: number): Record<string, unknown> =>
			Object.fromEntries(
				Array.from({ length: count }, (_, index) => [`key-${index}`, index]),
			);
		await writeFile(join(approved, "valid.md"), "valid", "utf8");
		await writeFile(
			join(approved, "valid.md.json"),
			JSON.stringify({ title: "Valid title" }),
			"utf8",
		);
		await writeFile(join(approved, "malformed.md"), "malformed", "utf8");
		await writeFile(join(approved, "malformed.md.json"), "{not-json", "utf8");
		await writeFile(join(approved, "proto.md"), "proto", "utf8");
		await writeFile(
			join(approved, "proto.md.json"),
			'{"__proto__":{"polluted":true},"title":"unsafe"}',
			"utf8",
		);
		await writeFile(join(approved, "prototype.md"), "prototype", "utf8");
		await writeFile(
			join(approved, "prototype.md.json"),
			'{"prototype":{"polluted":true}}',
			"utf8",
		);
		await writeFile(join(approved, "exact-depth.md"), "depth", "utf8");
		await writeFile(
			join(approved, "exact-depth.md.json"),
			JSON.stringify(nested(8)),
			"utf8",
		);
		await writeFile(join(approved, "over-depth.md"), "depth", "utf8");
		await writeFile(
			join(approved, "over-depth.md.json"),
			JSON.stringify(nested(9)),
			"utf8",
		);
		await writeFile(join(approved, "exact-nodes.md"), "nodes", "utf8");
		await writeFile(
			join(approved, "exact-nodes.md.json"),
			JSON.stringify(keyed(1024)),
			"utf8",
		);
		await writeFile(join(approved, "over-nodes.md"), "nodes", "utf8");
		await writeFile(
			join(approved, "over-nodes.md.json"),
			JSON.stringify(keyed(1025)),
			"utf8",
		);
		await writeFile(join(approved, "array-root.md"), "array", "utf8");
		await writeFile(join(approved, "array-root.md.json"), "[]", "utf8");
		const result = await scan(
			baseConfig(approved, {
				include: ["*.md"],
				titleStrategy: "sidecarTitle",
				sidecar: { enabled: true, extension: ".json" },
			}),
			approved,
			"sidecar-limits",
		);
		expect(result.items).toHaveLength(9);
		expect(
			result.items.find((item) => item.filename === "valid.md")?.title,
		).toBe("Valid title");
		expect(result.stats.sidecarFilesFailed).toBe(6);
		expect(
			result.warnings.every(
				(warning: unknown) => !JSON.stringify(warning).includes(approved),
			),
		).toBe(true);
		const byteRoot = join(root, "byte-edge");
		await mkdir(byteRoot);
		const exactSidecar = '{"title":"x"}';
		await writeFile(join(byteRoot, "exact.md"), "exact", "utf8");
		await writeFile(join(byteRoot, "exact.md.json"), exactSidecar, "utf8");
		await writeFile(join(byteRoot, "over.md"), "over", "utf8");
		await writeFile(join(byteRoot, "over.md.json"), `${exactSidecar} `, "utf8");
		const observedSidecarReads: number[] = [];
		const byteLimited = await scan(
			baseConfig(byteRoot, {
				include: ["*.md"],
				sidecar: { enabled: true, extension: ".json" },
			}),
			byteRoot,
			"sidecar-bytes",
			{
				limits: {
					maxSidecarBytes: new TextEncoder().encode(exactSidecar).byteLength,
				},
				fs: {
					onRead: (_kind: string, _path: string, requestedBytes: number) =>
						observedSidecarReads.push(requestedBytes),
				},
			},
		);
		expect(byteLimited.items.map((item) => item.filename)).toEqual([
			"exact.md",
			"over.md",
		]);
		expect(byteLimited.stats.sidecarFilesFailed).toBe(1);
		expect(byteLimited.warnings.length).toBeGreaterThan(0);
		expect(observedSidecarReads.length).toBeGreaterThan(0);
		expect(
			observedSidecarReads.every(
				(requestedBytes) => requestedBytes <= exactSidecar.length,
			),
		).toBe(true);
	});

	test("A4: sidecar skips never mutate prototypes or abort neighboring files", async () => {
		const root = await fixture("sidecar-prototype");
		const approved = join(root, "approved");
		await mkdir(approved);
		await writeFile(join(approved, "neighbor.md"), "neighbor", "utf8");
		await writeFile(
			join(approved, "neighbor.md.json"),
			'{"constructor":{"polluted":true}}',
			"utf8",
		);
		const result = await scan(
			baseConfig(approved, {
				include: ["*.md"],
				sidecar: { enabled: true, extension: ".json" },
			}),
			approved,
			"sidecar-prototype",
		);
		expect(result.items.some((item) => item.filename === "neighbor.md")).toBe(
			true,
		);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
	test("A7/E2: timeout, cancellation, unsafe I/O, and authorization errors have stable sanitized codes and safe counters", async () => {
		const root = await fixture("errors");
		const approved = join(root, "approved");
		const timeoutExactRoot = join(root, "timeout-exact");
		const timeoutOverRoot = join(root, "timeout-over");
		await mkdir(approved);
		await mkdir(timeoutExactRoot);
		await mkdir(timeoutOverRoot);
		await writeFile(join(approved, "secret.md"), "secret-content", "utf8");
		await writeFile(join(timeoutExactRoot, "exact.md"), "exact", "utf8");
		await writeFile(join(timeoutOverRoot, "over.md"), "over", "utf8");
		const sqlite = openStateDb(join(root, "state.db"));
		const store = createStateStore(sqlite);
		try {
			const initialState = await store.read("cancelled");
			const controller = new AbortController();
			controller.abort();
			await expectTypedFailure(
				scan(baseConfig(approved), approved, "cancelled", {
					signal: controller.signal,
					stateStore: store,
				}),
				/CANCEL/i,
				[root, "secret-content"],
			);
			expect(await store.read("cancelled")).toEqual(initialState);
			let exactClockIndex = 0;
			const exactTimeout = await scan(
				baseConfig(timeoutExactRoot),
				timeoutExactRoot,
				"timeout-exact",
				{
					stateStore: store,
					now: () => [0, 30_000, 30_000][Math.min(exactClockIndex++, 2)],
					limits: { maxElapsedMs: 30_000 },
				},
			);
			expect(exactTimeout.items).toHaveLength(1);
			await scan(baseConfig(timeoutOverRoot), timeoutOverRoot, "timed-out", {
				stateStore: store,
				now: () => 0,
			});
			const beforeTimeout = await store.read("timed-out");
			let overClockIndex = 0;
			await expectTypedFailure(
				scan(baseConfig(timeoutOverRoot), timeoutOverRoot, "timed-out", {
					stateStore: store,
					now: () => [0, 30_001, 30_001][Math.min(overClockIndex++, 2)],
					limits: { maxElapsedMs: 30_000 },
				}),
				/TIME|DEADLINE|LIMIT/i,
				[root, "secret-content"],
			);
			expect(await store.read("timed-out")).toEqual(beforeTimeout);
			await expectTypedFailure(
				scan(
					baseConfig(join(root, "approved-sibling")),
					approved,
					"unauthorized",
				),
				/AUTH|ROOT|OUTSIDE/i,
				[root],
			);
			let readCalls = 0;
			await scan(
				baseConfig(approved, { guidStrategy: "contentHash" }),
				approved,
				"unsafe-io",
				{
					stateStore: store,
				},
			);
			const beforeUnsafe = await store.read("unsafe-io");
			await expectTypedFailure(
				scan(
					baseConfig(approved, { guidStrategy: "contentHash" }),
					approved,
					"unsafe-io",
					{
						stateStore: store,
						fs: {
							readFile: async () => {
								readCalls += 1;
								throw Object.assign(new Error(`/host/${root}/secret-content`), {
									code: "UNSAFE_IO",
								});
							},
						},
					},
				),
				/IO|UNSAFE|RACE/i,
				[root, "secret-content"],
			);
			expect(readCalls).toBeGreaterThan(0);
			expect(await store.read("unsafe-io")).toEqual(beforeUnsafe);
		} finally {
			sqlite.close();
		}
	});
});

describe.serial("filesystem mapping and execution compatibility", () => {
	test("A12/I4: normalized relative paths, empty include, exclude precedence, mapping strategies, and public links remain compatible", async () => {
		const root = await fixture("mapping");
		const approved = join(root, "approved");
		await mkdir(join(approved, "private"), { recursive: true });
		await writeFile(join(approved, "public.md"), "hello", "utf8");
		await writeFile(join(approved, "private", "hidden.md"), "hidden", "utf8");
		const result = await scan(
			baseConfig(approved, {
				include: [],
				exclude: ["private/**"],
				publicBaseUrl: "https://files.example.test/base/",
				titleStrategy: "relativePath",
				descriptionStrategy: "fileMetadata",
				guidStrategy: "path",
			}),
			approved,
			"mapping",
		);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			relativePath: "public.md",
			title: "public.md",
			publicUrl: "https://files.example.test/base/public.md",
			guid: "public.md",
		});
		expect(result.items[0].description).toContain("public.md");
	});

	test("A13: preview and worker dispatch share the bounded scanner contract", async () => {
		const preview = await readFile(
			join(
				resolve(import.meta.dir, ".."),
				"utilities/preview-generator.utility.ts",
			),
			"utf8",
		);
		const worker = await readFile(
			join(resolve(import.meta.dir, ".."), "workers/feed-updater.worker.ts"),
			"utf8",
		);
		expect(preview).toContain("scanFilesystemFeed");
		expect(worker).toContain("scanFilesystemFeed");
		expect(preview).not.toMatch(/readdir|readFile|JSON\.parse/);
		expect(worker).not.toMatch(/readdir|readFile|JSON\.parse/);
		const feedsRoute = await readFile(
			join(resolve(import.meta.dir, ".."), "routes/feeds.ts"),
			"utf8",
		);
		expect(feedsRoute).toContain("saveFilesystemFeedConfig");
		expect(
			feedsRoute.match(/saveFilesystemFeedConfig\s*\(/g)?.length ?? 0,
		).toBeGreaterThanOrEqual(2);
		expect(feedsRoute).not.toMatch(/writeFile\((?:configPath|yamlFilePath)/);
	});
});

describe.serial("managed SQLite filesystem state", () => {
	test("A8/E1: schema has one row per feed/relative path and feed-scoped lookup index", async () => {
		const root = await fixture("schema");
		const sqlite = openStateDb(join(root, "runtime.db"));
		try {
			const table = sqlite
				.query(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='filesystem_feed_state'",
				)
				.all() as Array<{ name: string }>;
			expect(table).toHaveLength(1);
			const columns = (
				sqlite
					.query("PRAGMA table_info(filesystem_feed_state)")
					.all() as Array<{ name: string }>
			).map((row) => row.name);
			expect(columns).toEqual(
				expect.arrayContaining([
					"feed_id",
					"relative_path",
					"stable_id",
					"first_seen_at",
					"last_seen_at",
					"last_modified_at",
					"size_bytes",
					"content_hash",
				]),
			);
			const indexes = sqlite
				.query("PRAGMA index_list(filesystem_feed_state)")
				.all() as Array<{ name: string; unique: number }>;
			expect(indexes.length).toBeGreaterThan(0);
			const indexColumns = indexes.map((index) => ({
				unique: index.unique === 1,
				columns: (
					sqlite
						.query(`PRAGMA index_info(${JSON.stringify(index.name)})`)
						.all() as Array<{ name: string }>
				).map((column) => column.name),
			}));
			expect(indexColumns).toEqual(
				expect.arrayContaining([
					{ unique: true, columns: ["feed_id", "relative_path"] },
				]),
			);
			expect(
				indexColumns.some((index) => index.columns.includes("feed_id")),
			).toBe(true);
		} finally {
			sqlite.close();
		}
	});

	test("A9/I2/E4: complete scans commit observations/disappearance atomically and failed scans leave old complete state", async () => {
		const root = await fixture("transactions");
		const approved = join(root, "approved");
		await mkdir(approved);
		await writeFile(join(approved, "old.md"), "old", "utf8");
		const sqlite = openStateDb(join(root, "runtime.db"));
		try {
			const store = createStateStore(sqlite);
			await scan(baseConfig(approved), approved, "transactional", {
				stateStore: store,
				clock: () => new Date("2026-09-11T00:00:00.000Z"),
			});
			expect(existsSync(join(root, ".test-state", "transactional.json"))).toBe(
				false,
			);
			expect(
				existsSync(
					join(
						resolve(import.meta.dir, ".."),
						"feed-state",
						"filesystem",
						"transactional.json",
					),
				),
			).toBe(false);
			await rm(join(approved, "old.md"));
			await writeFile(join(approved, "new.md"), "new", "utf8");
			const complete = await scan(
				baseConfig(approved),
				approved,
				"transactional",
				{
					stateStore: store,
					clock: () => new Date("2026-09-11T00:01:00.000Z"),
				},
			);
			expect(complete.items.map((item) => item.relativePath)).toEqual([
				"new.md",
			]);
			const afterComplete = await store.read("transactional");
			expect(afterComplete.map((row) => row.relativePath)).toEqual(["new.md"]);
			sqlite.run(
				"CREATE TRIGGER p3_filesystem_abort BEFORE UPDATE ON filesystem_feed_state BEGIN SELECT RAISE(ABORT, 'filesystem state update failure'); END",
			);
			const beforeFailed = await store.read("transactional");
			await writeFile(join(approved, "new.md"), "new-content", "utf8");
			await expect(
				scan(baseConfig(approved), approved, "transactional", {
					stateStore: store,
				}),
			).rejects.toThrow();
			sqlite.run("DROP TRIGGER p3_filesystem_abort");
			expect(await store.read("transactional")).toEqual(beforeFailed);
			expect(existsSync(join(root, ".test-state", "transactional.json"))).toBe(
				false,
			);
			expect(
				existsSync(
					join(
						resolve(import.meta.dir, ".."),
						"feed-state",
						"filesystem",
						"transactional.json",
					),
				),
			).toBe(false);
		} finally {
			sqlite.close();
		}
	});

	test("A9/E4: genuinely concurrent scans preserve every observation and do not expose half-complete state", async () => {
		const root = await fixture("concurrent");
		const approved = join(root, "approved");
		await mkdir(approved);
		await Promise.all(
			["a.md", "b.md", "c.md"].map((name) =>
				writeFile(join(approved, name), name, "utf8"),
			),
		);
		const dbPath = join(root, "runtime.db");
		const sqliteA = openStateDb(dbPath);
		const sqliteB = openStateDb(dbPath);
		try {
			let startedResolve: (() => void) | undefined;
			const started = new Promise<void>((resolveStarted) => {
				startedResolve = resolveStarted;
			});
			let releaseCommit: (() => void) | undefined;
			const commitGate = new Promise<void>((resolveCommit) => {
				releaseCommit = resolveCommit;
			});
			const storeA = createStateStore(sqliteA, {
				onCommit: async () => {
					startedResolve?.();
					await commitGate;
				},
			});
			const storeB = createStateStore(sqliteB);
			const firstScan = scan(baseConfig(approved), approved, "concurrent", {
				stateStore: storeA,
			});
			await started;
			expect(await storeB.read("concurrent")).toHaveLength(0);
			const secondScan = scan(baseConfig(approved), approved, "concurrent", {
				stateStore: storeB,
			});
			releaseCommit?.();
			await Promise.all([firstScan, secondScan]);
			const rows = await storeA.read("concurrent");
			expect(rows).toHaveLength(3);
			expect(new Set(rows.map((row) => row.relativePath)).size).toBe(3);
			expect(new Set(rows.map((row) => row.stableId)).size).toBe(3);
			expect(await storeB.read("concurrent")).toEqual(rows);
		} finally {
			sqliteB.close();
			sqliteA.close();
		}
	});

	test("A10: state survives closing/reopening and first-seen identity remains stable while metadata advances", async () => {
		const root = await fixture("restart");
		const approved = join(root, "approved");
		await mkdir(approved);
		const file = join(approved, "stable.md");
		await writeFile(file, "one", "utf8");
		const dbPath = join(root, "runtime.db");
		const first = openStateDb(dbPath);
		let before: StateRow;
		try {
			const store = createStateStore(first, {
				clock: () => new Date("2026-09-11T00:00:00.000Z"),
			});
			await scan(baseConfig(approved), approved, "restart", {
				stateStore: store,
			});
			before = (await store.read("restart"))[0];
		} finally {
			first.close();
		}
		await writeFile(file, "two-two", "utf8");
		await utimes(
			file,
			new Date("2026-09-11T01:00:00.000Z"),
			new Date("2026-09-11T01:00:00.000Z"),
		);
		const second = openStateDb(dbPath);
		try {
			const store = createStateStore(second, {
				clock: () => new Date("2026-09-11T01:00:00.000Z"),
			});
			await scan(baseConfig(approved), approved, "restart", {
				stateStore: store,
			});
			const after = (await store.read("restart"))[0];
			expect(after.stableId).toBe(before.stableId);
			expect(after.firstSeenAt).toBe(before.firstSeenAt);
			expect(after.lastSeenAt).not.toBe(before.lastSeenAt);
			expect(after.sizeBytes).toBeGreaterThan(before.sizeBytes);
			expect(after.lastModifiedAt).not.toBe(before.lastModifiedAt);
		} finally {
			second.close();
		}
	});

	test("A11/I1/E5: legacy JSON copy-forward is idempotent, safe, conflict-respecting, and source-preserving", async () => {
		const root = await fixture("legacy");
		const legacyDir = join(root, "legacy");
		await mkdir(legacyDir);
		const valid = {
			files: {
				"docs/a.md": {
					stableId: "stable-a",
					firstSeenAt: "2026-09-01T00:00:00.000Z",
					lastSeenAt: "2026-09-10T00:00:00.000Z",
					lastModifiedAt: "2026-09-09T00:00:00.000Z",
					lastSizeBytes: 4,
				},
			},
		};
		const validPath = join(legacyDir, "feed-a.json");
		const validContents = JSON.stringify(valid);
		await writeFile(validPath, validContents, "utf8");
		const neighbor = {
			files: {
				"docs/b.md": {
					stableId: "stable-b",
					firstSeenAt: "2026-09-02T00:00:00.000Z",
					lastSeenAt: "2026-09-10T00:00:00.000Z",
					lastModifiedAt: "2026-09-09T00:00:00.000Z",
					lastSizeBytes: 5,
				},
			},
		};
		const neighborPath = join(legacyDir, "feed-b.json");
		const neighborContents = JSON.stringify(neighbor);
		await writeFile(neighborPath, neighborContents, "utf8");
		const malformedPath = join(legacyDir, "feed-bad.json");
		await writeFile(malformedPath, "{malformed", "utf8");
		await writeFile(
			join(legacyDir, "feed-unsafe.json"),
			JSON.stringify({ files: { "../escape.md": valid.files["docs/a.md"] } }),
			"utf8",
		);
		const autoLegacyDir = join(root, "auto-legacy");
		await mkdir(autoLegacyDir);
		await writeFile(
			join(autoLegacyDir, "feed-auto.json"),
			JSON.stringify(neighbor),
			"utf8",
		);
		const autoSqlite = openStateDb(join(root, "auto.db"));
		try {
			const autoStore = createStateStore(autoSqlite, {
				legacyDir: autoLegacyDir,
			});
			expect((await autoStore.read("feed-auto"))[0]?.stableId).toBe("stable-b");
		} finally {
			autoSqlite.close();
		}
		const sqlite = openStateDb(join(root, "runtime.db"));
		try {
			const store = createStateStore(sqlite, { legacyDir });
			sqlite.run(
				`INSERT INTO filesystem_feed_state
				 (feed_id, relative_path, stable_id, first_seen_at, last_seen_at, last_modified_at, size_bytes)
				 VALUES ('feed-a', 'docs/a.md', 'sqlite-wins', '2026-08-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z', '2026-09-09T00:00:00.000Z', 99)`,
			);
			const first = await store.migrateLegacy();
			expect(migrationCount(first)).toBe(1);
			expect(JSON.stringify(first)).not.toContain(legacyDir);
			expect((await store.read("feed-a"))[0]?.stableId).toBe("sqlite-wins");
			expect((await store.read("feed-b"))[0]?.stableId).toBe("stable-b");
			expect(await store.read("feed-unsafe")).toHaveLength(0);
			expect(await readFile(validPath, "utf8")).toBe(validContents);
			expect(await readFile(neighborPath, "utf8")).toBe(neighborContents);
			expect(await readFile(malformedPath, "utf8")).toBe("{malformed");
			const second = await store.migrateLegacy();
			expect(migrationCount(second)).toBe(0);
			const rows = await store.read("feed-a");
			expect(rows).toHaveLength(1);
			expect(existsSync(join(legacyDir, "feed-b.json"))).toBe(true);
		} finally {
			sqlite.close();
		}
	});
});
