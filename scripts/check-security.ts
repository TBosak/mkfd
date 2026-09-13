/**
 * Deterministic security gate: local Semgrep rules, dependency vulnerabilities,
 * and secret scanning.
 *
 * Each scanner is optional-but-loud: if the binary is missing the step is
 * reported as SKIPPED with the install command rather than silently passing.
 * A security gate that quietly does nothing is worse than no gate, because it
 * reads as evidence.
 *
 * Semgrep has no native Windows build, so it runs through its official
 * container. That is also what CI uses, which keeps one command for both.
 */

import { existsSync } from "node:fs";

type Outcome = "pass" | "fail" | "skip";

interface Step {
	name: string;
	outcome: Outcome;
	detail: string;
}

const steps: Step[] = [];
const repoRoot = process.cwd();

function have(bin: string): boolean {
	const probe = Bun.spawnSync({
		cmd: process.platform === "win32" ? ["where", bin] : ["which", bin],
		stdout: "pipe",
		stderr: "pipe",
	});
	return probe.exitCode === 0;
}

function run(
	name: string,
	cmd: string[],
	installHint: string,
	skipIf?: boolean,
): void {
	if (skipIf) {
		steps.push({
			name,
			outcome: "skip",
			detail: `not installed — ${installHint}`,
		});
		return;
	}
	const result = Bun.spawnSync({
		cmd,
		stdout: "pipe",
		stderr: "pipe",
		cwd: repoRoot,
	});
	const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
	if (result.exitCode === 0) {
		steps.push({ name, outcome: "pass", detail: "clean" });
	} else {
		steps.push({
			name,
			outcome: "fail",
			detail: output.trim().split("\n").slice(-25).join("\n"),
		});
	}
}

// --- Semgrep: Mkfd's own committed rules ------------------------------------
// Community rulesets are deliberately not run here. Local committed rules are
// the deterministic project policy; an external ruleset belongs in an advisory
// scan until its false positives have been reviewed.
const semgrepRules = ".semgrep/mkfd-rules.yml";
if (!existsSync(semgrepRules)) {
	steps.push({
		name: "semgrep",
		outcome: "skip",
		detail: `${semgrepRules} missing`,
	});
} else if (have("semgrep")) {
	run(
		"semgrep",
		[
			"semgrep",
			"--config",
			semgrepRules,
			"--error",
			"--metrics=off",
			"--quiet",
			".",
		],
		"",
	);
} else if (have("docker")) {
	run(
		"semgrep (docker)",
		[
			"docker",
			"run",
			"--rm",
			"-v",
			`${repoRoot}:/src`,
			"-w",
			"/src",
			"semgrep/semgrep",
			"semgrep",
			"--config",
			semgrepRules,
			"--error",
			"--metrics=off",
			"--quiet",
			".",
		],
		"",
	);
} else {
	steps.push({
		name: "semgrep",
		outcome: "skip",
		detail:
			"neither semgrep nor docker found — install Docker Desktop, or `pip install semgrep` on Linux/macOS",
	});
}

// --- OSV-Scanner: dependency vulnerabilities --------------------------------
run(
	"osv-scanner",
	["osv-scanner", "scan", "source", "--lockfile", "bun.lock"],
	"winget install Google.OSVScanner (or see https://google.github.io/osv-scanner)",
	!have("osv-scanner"),
);

// --- Gitleaks: secrets in the working tree ----------------------------------
run(
	"gitleaks",
	["gitleaks", "dir", ".", "--no-banner", "-c", ".gitleaks.toml"],
	"winget install Gitleaks.Gitleaks",
	!have("gitleaks"),
);

// --- Report -----------------------------------------------------------------
let failed = false;
console.log("");
for (const step of steps) {
	const mark =
		step.outcome === "pass"
			? "PASS"
			: step.outcome === "skip"
				? "SKIP"
				: "FAIL";
	console.log(`${mark}  ${step.name}`);
	if (step.outcome === "fail") {
		failed = true;
		console.log(step.detail.replace(/^/gm, "      "));
	} else if (step.outcome === "skip") {
		console.log(`      ${step.detail}`);
	}
}
console.log("");

if (failed) process.exit(1);
