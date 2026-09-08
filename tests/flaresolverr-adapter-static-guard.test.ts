// TDD slice: p3-flaresolverr-adapter
//
// Requirement 1 ("one adapter is the only way to reach FlareSolverr") and its
// anti-bypass clause: "Do not satisfy requirement 1 by leaving a direct
// axios.post in place and adding validation beside it."
//
// This is a literal-text guard, deliberately narrower than the locked
// tests/outbound-network-primitives-architecture.test.ts (which scans all of
// routes/, utilities/, workers/, node/ against a reviewable exception
// ledger). That test is not this slice's to edit, and its ledger already
// carries six FlareSolverr-marker exceptions that exist *because* today these
// six files still call axios.post directly for FlareSolverr. Once this slice
// migrates every one of them to the new adapter, those six markers stop
// matching anything — the locked test tolerates that (its own sanity check
// only requires *some* real site to remain covered, and several non-
// FlareSolverr exceptions do) — but nothing in that locked file positively
// *requires* the axios.post calls to disappear. This file supplies that
// missing, targeted assertion: the six production files the brief names as
// owning a FlareSolverr call site must not contain a direct axios.post call
// at all once the adapter exists.
//
// Read as plain source text rather than imported, so this is a proof about
// what ships, not about whichever branch happens to run in this process.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

// The six files the brief's ownership section names as owning one of the
// seven FlareSolverr call sites (data-handler.utility.ts owns two).
const FLARESOLVERR_CALL_SITE_FILES = [
	"routes/utils.ts",
	"utilities/data-handler.utility.ts",
	"utilities/feed-config-route-adapter.utility.ts",
	"utilities/preview-generator.utility.ts",
	"utilities/selector-suggestion.utility.ts",
	"workers/feed-updater.worker.ts",
];

// A direct axios POST call, or the bare callable form used with a `method:
// "post"` config object. Deliberately does not match `axios.get(` — several
// of these files legitimately keep a direct `axios.get` for their FlareSolverr
// *health-check* GET (routes/utils.ts's /api/flaresolverr/health), which is
// not one of the seven call sites this slice migrates.
const DIRECT_POST_PATTERN = /\baxios\.post\(/;

describe("FlareSolverr call sites no longer call axios.post directly (requirement 1)", () => {
	for (const relPath of FLARESOLVERR_CALL_SITE_FILES) {
		test(`${relPath} contains no direct axios.post call`, () => {
			const text = readFileSync(join(REPO_ROOT, relPath), "utf8");
			const match = text.match(DIRECT_POST_PATTERN);
			expect(
				match,
				`${relPath} still calls axios.post directly for FlareSolverr; ` +
					"it must go through the shared adapter instead so the SSRF check " +
					"cannot be skipped by a future edit.",
			).toBeNull();
		});
	}
});
