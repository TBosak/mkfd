/**
 * Fails if the generated agent instruction files have drifted from `.ruler/`.
 *
 * Drift is checked by idempotency, not by comparing against Git HEAD: the
 * working tree in this repository is routinely dirty with work in progress, so
 * a HEAD comparison would report drift for every uncommitted change and would
 * also pass in CI for the wrong reason. Hashing the generated files, running
 * Ruler, and hashing again answers the question actually being asked — "is what
 * is on disk what `.ruler/` produces?" — in both situations.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const GENERATED = ["AGENTS.md", "CLAUDE.md", ".mcp.json"];

function digest(path: string): string {
	if (!existsSync(path)) return "<missing>";
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const before = new Map(GENERATED.map((path) => [path, digest(path)]));

const applied = Bun.spawnSync({
	cmd: ["bun", "run", "agents:apply"],
	stdout: "pipe",
	stderr: "pipe",
});

if (applied.exitCode !== 0) {
	console.error(new TextDecoder().decode(applied.stderr));
	console.error("ruler apply failed; cannot verify agent instruction drift.");
	process.exit(applied.exitCode ?? 1);
}

const drifted = GENERATED.filter((path) => before.get(path) !== digest(path));

if (drifted.length > 0) {
	console.error(
		`Agent instruction files are out of sync with .ruler/: ${drifted.join(", ")}\n` +
			"They have now been regenerated. Review and commit the change — and edit\n" +
			".ruler/, never the generated files.",
	);
	process.exit(1);
}

console.log(
	`Agent instructions in sync with .ruler/ (${GENERATED.join(", ")}).`,
);
