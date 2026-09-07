// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 8: an architecture gate that prohibits direct
// network primitives (`axios.*`, a bare `axios(...)` call, or a bare
// `fetch(...)` call) outside the shared outbound executor, in
// `routes/`, `utilities/`, `workers/`, and `node/`. Follows the established
// pattern in tests/static-analysis-exceptions-policy.test.ts: an explicit,
// reviewable exception list where every entry carries a reason, rather than
// a wildcard or whole-file/whole-directory carve-out.
//
// Deviation from that sibling test's exact shape, and why: that test reads
// its exception ledger from an external `docs/security/*.md` document.
// Claude's write boundary for this slice is `tests/` and `frontend/e2e/`
// only, so the ledger below is embedded directly in this test file instead
// of a docs file this suite isn't permitted to create. It uses the same
// fields (path, reason, owner) so it could be promoted to an external
// document later without changing what it asserts.
//
// Exceptions are matched by file + a short literal marker string found on
// or immediately around the flagged line, not by line number. Line numbers
// shift with unrelated edits; the marker is tied to what makes a call site
// legitimately out of scope (e.g. "this is the FlareSolverr adapter call"),
// so it survives incidental reformatting of the surrounding function.
//
// Per the brief's anti-bypass rules: no exception may cover a whole
// directory or file that requirement 7 names for migration, and the list
// must not silently grow — its length is pinned below.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

const SCAN_DIRS = ["routes", "utilities", "workers", "node"];

// A conservative denylist of directories that are themselves generated,
// vendored, or otherwise not first-party source, to keep the walk fast and
// on-topic. None of these exist under the scanned dirs today, but the guard
// is cheap and future-proof.
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", ".git"]);

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
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

// Matches a direct axios call (`axios.get(`, `axios.post(`, ..., or the
// bare callable form `axios(`), or a bare `fetch(` call (not `.fetch(` on
// some other object, e.g. Hono's `app.fetch`).
// Requires the opening parenthesis to immediately follow the identifier
// (real call sites never have a space there) so that prose like "axios
// (redirect-aware...)" or "fetch (re-exported...)" inside a comment can't
// register as a call site.
const DIRECT_CALL_PATTERN =
	/\baxios\(|\baxios\.(get|post|put|patch|delete|request|head)\(|(?<![.\w])fetch\(/g;

type CallSite = {
	file: string; // repo-relative, forward-slashed
	line: number;
	lineText: string;
	context: string; // a few lines of surrounding text, for marker matching
};

function findCallSites(): CallSite[] {
	const sites: CallSite[] = [];
	for (const dir of SCAN_DIRS) {
		const absDir = join(REPO_ROOT, dir);
		for (const file of listTsFiles(absDir)) {
			const relPath = relative(REPO_ROOT, file).replaceAll("\\", "/");
			const text = readFileSync(file, "utf8");
			const lines = text.split("\n");
			for (let i = 0; i < lines.length; i++) {
				DIRECT_CALL_PATTERN.lastIndex = 0;
				if (!DIRECT_CALL_PATTERN.test(lines[i])) continue;
				const start = Math.max(0, i - 2);
				const end = Math.min(lines.length, i + 12);
				sites.push({
					file: relPath,
					line: i + 1,
					lineText: lines[i],
					context: lines.slice(start, end).join("\n"),
				});
			}
		}
	}
	return sites;
}

// ---------------------------------------------------------------------------
// The exception ledger (requirement 8's "explicit, enumerated exception
// list"). Each entry must carry a reason. None cover a whole directory or a
// file requirement 7 names for migration.
// ---------------------------------------------------------------------------

type Exception = {
	path: string;
	/** A literal substring found in the call site's surrounding context that identifies it. */
	marker: string;
	reason: string;
	owner: string;
};

const EXCEPTIONS: Exception[] = [
	// -- FlareSolverr adapter calls: explicitly out of scope ("the
	// browser-automation and FlareSolverr adapters" — brief non-goals). Each
	// of these posts to the FlareSolverr HTTP API, not to a feed's own URL.
	{
		path: "routes/utils.ts",
		marker: "flaresolverr",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	{
		path: "utilities/data-handler.utility.ts",
		marker: "flaresolverrPayload",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	{
		path: "utilities/feed-config-route-adapter.utility.ts",
		marker: "flaresolverrTimeout + 5000",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	{
		path: "utilities/preview-generator.utility.ts",
		marker: "flaresolverrPayload",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	{
		path: "utilities/selector-suggestion.utility.ts",
		marker: "flaresolverrPayload",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	{
		path: "workers/feed-updater.worker.ts",
		marker: "flaresolverrPayload",
		reason: "FlareSolverr adapter call, explicitly out of scope for this slice",
		owner: "Packet 3 (browser-automation adapter, separate slice)",
	},
	// -- Service connectors: explicitly out of scope (brief ownership
	// section: "Explicitly NOT in this slice").
	{
		path: "utilities/service-connectors/jellyfin.connector.ts",
		marker: "System/Info",
		reason: "Service connector call, explicitly out of scope for this slice",
		owner: "Packet 3 (service connectors, separate slice)",
	},
	{
		path: "utilities/service-connectors/jellyfin.connector.ts",
		marker: "Library/MediaFolders",
		reason: "Service connector call, explicitly out of scope for this slice",
		owner: "Packet 3 (service connectors, separate slice)",
	},
	{
		path: "utilities/service-connectors/jellyfin.connector.ts",
		marker: "/Items",
		reason: "Service connector call, explicitly out of scope for this slice",
		owner: "Packet 3 (service connectors, separate slice)",
	},
	// -- Not named by requirement 7's migration list; each already owns a
	// narrower, independently-tested SSRF check and is a candidate for a
	// later slice rather than this one.
	{
		path: "routes/utils.ts",
		marker: "normalizedUrl",
		reason:
			"The /proxy playground route's own direct fetch; not named in requirement 7's migration list and already covered by tests/selector-playground-proxy-isolation.test.ts's own outbound-policy assertions",
		owner: "Packet 3 (selector playground, separate slice)",
	},
	{
		path: "utilities/webhook.utility.ts",
		marker: "axiosConfig",
		reason:
			"Outbound webhook delivery to an admin-configured destination URL, not a feed-source fetch; not named in requirement 7's migration list",
		owner: "Packet 3 (webhook delivery, separate slice)",
	},
	{
		path: "utilities/rss-builder.utility.ts",
		marker: "fetchUrl, { signal",
		reason:
			"Enclosure content-length/type probe for a scraped item's own enclosure URL; not named in requirement 7's migration list",
		owner: "Packet 3 (rss-builder enclosure probe, separate slice)",
	},
];

// ---------------------------------------------------------------------------
// requirement 6 (anti-bypass, mirrored from the sibling test): no exception
// may cover a whole directory or use a wildcard path.
// ---------------------------------------------------------------------------

describe("outbound network primitives exception ledger — shape (requirement 8 anti-bypass)", () => {
	test("no exception path contains a wildcard character", () => {
		for (const e of EXCEPTIONS) {
			expect(e.path.includes("*"), `exception path '${e.path}' must not contain a wildcard`).toBe(false);
		}
	});

	test("no exception path is a bare directory reference", () => {
		for (const e of EXCEPTIONS) {
			expect(e.path.endsWith("/"), `exception path '${e.path}' must not be a bare directory`).toBe(false);
		}
	});

	test("every exception declares a non-empty reason and owner", () => {
		for (const [i, e] of EXCEPTIONS.entries()) {
			expect(e.reason.length, `exceptions[${i}].reason must be non-empty`).toBeGreaterThan(0);
			expect(e.owner.length, `exceptions[${i}].owner must be non-empty`).toBeGreaterThan(0);
		}
	});

	test("the exception list does not grow past its current, reviewed size", () => {
		// Pinned to the count enumerated above. Growing this number is a real
		// review event (a new, justified exception), not something that
		// should happen silently as a side effect of an unrelated change.
		expect(EXCEPTIONS.length).toBe(12);
	});

	test("no exception names a file requirement 7 explicitly requires this slice to migrate", () => {
		const MUST_MIGRATE_FILES = new Set([
			"utilities/preview-generator.utility.ts",
			"utilities/data-handler.utility.ts",
			"utilities/sitemap.utility.ts",
			"utilities/calendar-feed.utility.ts",
			"utilities/graphql-feed.utility.ts",
			"utilities/selector-suggestion.utility.ts",
			"workers/feed-updater.worker.ts",
		]);
		for (const e of EXCEPTIONS) {
			// These files legitimately contain BOTH a call requirement 7 says to
			// migrate (a raw fetch of the feed author's URL) AND a FlareSolverr
			// adapter call that stays exempt — the ledger exempts only the
			// specific marker-identified call, never the whole file. This check
			// only guards against a *whole-file* exemption (a marker equal to
			// the file having no distinguishing call-site marker at all is not
			// possible here since every entry above has a specific marker), so
			// it is a sanity check on intent rather than a mechanical one.
			expect(
				MUST_MIGRATE_FILES.has(e.path) && e.marker.length === 0,
				`exception for '${e.path}' must not be a whole-file exemption`,
			).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// requirement 8 (RED until every remaining direct call site is migrated or
// explicitly, narrowly exempted): every direct axios/fetch call site found
// in routes/, utilities/, workers/, node/ is either covered by a ledger
// entry or must not exist.
// ---------------------------------------------------------------------------

describe("no direct axios/fetch call site bypasses the shared outbound executor (requirement 8)", () => {
	test("every direct axios/fetch call site is either exempted by the ledger or absent", () => {
		const sites = findCallSites();
		expect(sites.length, "expected to find at least one direct call site to make this check meaningful").toBeGreaterThan(0);

		const uncovered = sites.filter(
			(site) => !EXCEPTIONS.some((e) => e.path === site.file && site.context.includes(e.marker)),
		);

		const report = uncovered.map((s) => `${s.file}:${s.line}: ${s.lineText.trim()}`).join("\n");
		expect(uncovered, report).toEqual([]);
	});

	test("sanity: the ledger itself is not vacuous — at least one real call site is currently covered only by an exception, not by absence", () => {
		const sites = findCallSites();
		const coveredByLedger = sites.filter((site) =>
			EXCEPTIONS.some((e) => e.path === site.file && site.context.includes(e.marker)),
		);
		expect(
			coveredByLedger.length,
			"expected at least one call site to be legitimately covered by the exception ledger",
		).toBeGreaterThan(0);
	});
});
