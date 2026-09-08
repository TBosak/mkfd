// TDD slice: p3-browser-adapter
//
// Requirement 7: "A static guard, in the shape of
// tests/flaresolverr-adapter-static-guard.test.ts: no chromium.launch,
// browser.newPage, or page.goto may appear in routes/, utilities/,
// workers/, node/ outside the adapter." lib/outbound/browser-adapter.ts
// lives outside all four scanned directories -- exactly the same reason
// tests/flaresolverr-adapter-static-guard.test.ts's own guard never needs an
// exception ledger entry for lib/outbound/flaresolverr-adapter.ts -- so no
// path exclusion is needed here either; the scan below is a plain,
// unconditional walk.
//
// Read as plain source text, not imported: this is a proof about what
// ships, not about whichever branch happens to run in this process (same
// rationale as the FlareSolverr sibling).
//
// Also carries the anti-bypass check the brief's "Notes for the test
// author" calls out directly: a single `as any` or the literal string
// `as unknown as` (anywhere in the adapter file, including a comment) is
// enough to breach the project's anti-bypass gate -- "that has now cost two
// slices" per the brief. Encoding it here, scoped to this one file, gives a
// concrete, fast, targeted proof instead of relying solely on the broader
// project-wide `tests/static-diagnostics-cleanup-anti-bypass.test.ts`
// ceilings.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

const SCAN_DIRS = ["routes", "utilities", "workers", "node"];
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", ".git"]);

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIR_NAMES.has(entry)) continue;
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "chromium.launch(", pattern: /\bchromium\.launch\(/ },
	{ name: "browser.newPage(", pattern: /\bbrowser\.newPage\(/ },
	{ name: "page.goto(", pattern: /\bpage\.goto\(/ },
];

type Hit = { file: string; pattern: string; line: number; lineText: string };

function scanForHits(): Hit[] {
	const hits: Hit[] = [];
	for (const dir of SCAN_DIRS) {
		const absDir = join(REPO_ROOT, dir);
		for (const file of listTsFiles(absDir)) {
			const relPath = relative(REPO_ROOT, file).replaceAll("\\", "/");
			const text = readFileSync(file, "utf8");
			const lines = text.split("\n");
			for (let i = 0; i < lines.length; i++) {
				for (const { name, pattern } of FORBIDDEN_PATTERNS) {
					if (pattern.test(lines[i])) {
						hits.push({
							file: relPath,
							pattern: name,
							line: i + 1,
							lineText: lines[i].trim(),
						});
					}
				}
			}
		}
	}
	return hits;
}

describe("no direct browser-automation primitive appears in routes/, utilities/, workers/, or node/ (requirement 7)", () => {
	test("a full recursive scan finds zero chromium.launch(/browser.newPage(/page.goto( call sites", () => {
		const hits = scanForHits();
		expect(
			hits,
			hits
				.map((h) => `${h.file}:${h.line} [${h.pattern}] ${h.lineText}`)
				.join("\n"),
		).toEqual([]);
	});
});

// Anti-bypass (lead review round 1, item 2): `scanForHits()` returns `[]`
// both when the codebase is genuinely clean AND when the walk found
// nothing at all -- `listTsFiles`'s `try { readdirSync(dir) } catch { return
// out; }` silently turns a renamed directory, a wrong working directory, or
// an OS-specific path-separator problem into an empty, "passing" result. A
// green guard that proves nothing is worse than a red one: nobody re-checks
// a passing test, so the invariant this whole file exists to protect could
// quietly stop being checked at all. Mirrors the non-vacuity check the
// locked architecture ledger already carries for the same class of failure
// (CF-13, docs/mkfd-v3-implementation-ledger.md).
describe("scan non-vacuity (anti-bypass): the walk must actually visit real files, not silently return empty", () => {
	test("each of the four scanned directories yields at least one discovered .ts file", () => {
		for (const dir of SCAN_DIRS) {
			const files = listTsFiles(join(REPO_ROOT, dir));
			expect(
				files.length,
				`expected at least one .ts file discovered under ${dir}/ -- got 0, which means the walk found nothing ` +
					"(a renamed directory, the wrong working directory, or an OS path-separator problem) rather than proving " +
					"a genuinely clean codebase.",
			).toBeGreaterThan(0);
		}
	});

	test("the total discovered file count across all four scanned directories is a plausible size for this codebase", () => {
		const total = SCAN_DIRS.reduce(
			(sum, dir) => sum + listTsFiles(join(REPO_ROOT, dir)).length,
			0,
		);
		expect(
			total,
			`expected at least 20 discovered .ts files across routes/, utilities/, workers/, and node/ -- got ${total}, ` +
				"far too few for this codebase; the walk likely failed silently rather than the tree having shrunk.",
		).toBeGreaterThanOrEqual(20);
	});
});

// Per-file assertions for the three files that own the four call sites the
// brief names (utilities/data-handler.utility.ts owns two of the four
// sites -- the drill-chain root and its steps -- but is one file), so a
// failure attributes cleanly to the specific file/pattern that still needs
// migrating rather than only a combined list.
const KNOWN_CALL_SITE_FILES = [
	"utilities/data-handler.utility.ts",
	"utilities/preview-generator.utility.ts",
	"workers/feed-updater.worker.ts",
];

describe("each of the three call-site files (covering all four call sites the brief names) no longer contains a direct browser-automation primitive (requirement 7)", () => {
	for (const relPath of KNOWN_CALL_SITE_FILES) {
		for (const { name, pattern } of FORBIDDEN_PATTERNS) {
			test(`${relPath} contains no '${name}' call`, () => {
				const text = readFileSync(join(REPO_ROOT, relPath), "utf8");
				expect(
					pattern.test(text),
					`${relPath} still contains a direct '${name}' call; it must go through lib/outbound/browser-adapter.ts instead.`,
				).toBe(false);
			});
		}
	}
});

describe("the adapter itself (lib/outbound/browser-adapter.ts) is not flagged by this guard (anti-bypass sanity)", () => {
	test("the adapter path does not fall under any scanned directory", () => {
		const adapterAbsPath = join(
			REPO_ROOT,
			"lib",
			"outbound",
			"browser-adapter.ts",
		);
		const relFromRepoRoot = relative(REPO_ROOT, adapterAbsPath).replaceAll(
			"\\",
			"/",
		);
		expect(SCAN_DIRS.some((dir) => relFromRepoRoot.startsWith(`${dir}/`))).toBe(
			false,
		);
	});
});

describe("lib/outbound/browser-adapter.ts exists and carries no 'as any' / 'as unknown as' escape (brief's anti-bypass note)", () => {
	const adapterPath = join(REPO_ROOT, "lib", "outbound", "browser-adapter.ts");

	test("the adapter file exists", () => {
		expect(
			existsSync(adapterPath),
			"expected lib/outbound/browser-adapter.ts to exist",
		).toBe(true);
	});

	test("no 'as any' cast anywhere in the file", () => {
		if (!existsSync(adapterPath)) {
			throw new Error("lib/outbound/browser-adapter.ts does not exist yet");
		}
		const text = readFileSync(adapterPath, "utf8");
		expect(
			/\bas\s+any\b/.test(text),
			"found 'as any' in lib/outbound/browser-adapter.ts",
		).toBe(false);
	});

	test("no 'as unknown as' anywhere in the file, including in a comment", () => {
		if (!existsSync(adapterPath)) {
			throw new Error("lib/outbound/browser-adapter.ts does not exist yet");
		}
		const text = readFileSync(adapterPath, "utf8");
		expect(
			text.includes("as unknown as"),
			"found 'as unknown as' in lib/outbound/browser-adapter.ts",
		).toBe(false);
	});
});
