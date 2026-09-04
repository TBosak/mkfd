import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

type Mode = "author" | "revise";

type SessionState = {
	id: string;
	sessionId: string;
	brief: string;
	model: string;
	testFiles: string[];
	createdAt: string;
	updatedAt: string;
};

type ClaudeResult = {
	modelUsage?: Record<string, unknown>;
	model_usage?: Record<string, unknown>;
	session_id?: unknown;
	result?: unknown;
};

const repoRoot = resolve(import.meta.dir, "..");
const stateDir = resolve(repoRoot, ".tdd-state");
const promptPath = resolve(
	repoRoot,
	"docs/agent-workflow/claude-test-author-prompt.md",
);

function option(name: string): string | undefined {
	const args = Bun.argv.slice(2);
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function normalizeRepoPath(path: string): string {
	return path.replaceAll("\\", "/");
}

function isSafeRelativePath(path: string): boolean {
	const normalized = normalizeRepoPath(path);
	return (
		normalized.length > 0 &&
		!normalized.startsWith("/") &&
		!/^[a-z]:\//i.test(normalized) &&
		!normalized.split("/").some((segment) => segment === ".." || segment === "")
	);
}

function isTestAuthorPath(path: string): boolean {
	const normalized = normalizeRepoPath(path);
	return (
		isSafeRelativePath(normalized) &&
		(normalized.startsWith("tests/") || normalized.startsWith("frontend/e2e/"))
	);
}

async function gitFileList(args: string[]): Promise<string[]> {
	const process = Bun.spawn(["git", "ls-files", "-z", ...args], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0)
		throw new Error(`Could not inventory repository files: ${stderr.trim()}`);
	return stdout.split("\0").filter(Boolean).map(normalizeRepoPath);
}

async function listRepositoryFiles(): Promise<string[]> {
	const [regular, protectedIgnored] = await Promise.all([
		gitFileList(["-co", "--exclude-standard"]),
		gitFileList([
			"-oi",
			"--exclude-standard",
			"--",
			"configs",
			".env",
			".env.*",
		]),
	]);
	return [...new Set([...regular, ...protectedIgnored])];
}

async function hashFile(path: string): Promise<string> {
	const bytes = await Bun.file(resolve(repoRoot, path)).arrayBuffer();
	return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function snapshotProtectedFiles(): Promise<Map<string, string>> {
	const snapshot = new Map<string, string>();
	for (const path of await listRepositoryFiles()) {
		if (isTestAuthorPath(path) || path.startsWith(".tdd-state/")) continue;
		snapshot.set(path, await hashFile(path));
	}
	return snapshot;
}

async function snapshotTestFiles(): Promise<Map<string, string>> {
	const snapshot = new Map<string, string>();
	for (const path of await listRepositoryFiles()) {
		if (isTestAuthorPath(path)) snapshot.set(path, await hashFile(path));
	}
	return snapshot;
}

function changedProtectedFiles(
	before: Map<string, string>,
	after: Map<string, string>,
): string[] {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths]
		.filter((path) => before.get(path) !== after.get(path))
		.sort();
}

function assertInsideRepository(path: string, label: string): string {
	const absolute = resolve(repoRoot, path);
	const rel = normalizeRepoPath(relative(repoRoot, absolute));
	if (!rel || rel === ".." || rel.startsWith("../")) {
		throw new Error(`${label} must be inside the repository: ${path}`);
	}
	return absolute;
}

function validateId(id: string): void {
	if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) {
		throw new Error("--id must be 3-80 lowercase letters, numbers, or hyphens");
	}
}

async function readState(path: string): Promise<SessionState> {
	return JSON.parse(await readFile(path, "utf8")) as SessionState;
}

async function main(): Promise<void> {
	const mode = Bun.argv[2] as Mode | undefined;
	if (mode !== "author" && mode !== "revise") {
		throw new Error(
			"Usage: bun run tdd:claude -- <author|revise> --id <slice-id> --brief <path> [--feedback <path>]",
		);
	}

	const id = option("--id");
	const briefArg = option("--brief");
	const feedbackArg = option("--feedback");
	if (!id || !briefArg) throw new Error("--id and --brief are required");
	validateId(id);
	if (mode === "revise" && !feedbackArg)
		throw new Error("--feedback is required in revise mode");

	const briefPath = assertInsideRepository(briefArg, "Brief");
	const feedbackPath = feedbackArg
		? assertInsideRepository(feedbackArg, "Feedback")
		: undefined;
	const [contract, brief, feedback] = await Promise.all([
		readFile(promptPath, "utf8"),
		readFile(briefPath, "utf8"),
		feedbackPath ? readFile(feedbackPath, "utf8") : Promise.resolve(""),
	]);

	await mkdir(stateDir, { recursive: true });
	const statePath = resolve(stateDir, `${id}.json`);
	const responsePath = resolve(stateDir, `${id}-last-response.json`);
	const now = new Date().toISOString();
	let state: SessionState;
	if (mode === "author") {
		state = {
			id,
			sessionId: randomUUID(),
			brief: normalizeRepoPath(relative(repoRoot, briefPath)),
			model: "sonnet",
			testFiles: [],
			createdAt: now,
			updatedAt: now,
		};
	} else {
		state = await readState(statePath).catch(() => {
			throw new Error(
				`No Claude session state found for ${id}; run author first`,
			);
		});
		if (state.brief !== normalizeRepoPath(relative(repoRoot, briefPath))) {
			throw new Error(
				`Brief does not match the original session brief: ${state.brief}`,
			);
		}
		state.updatedAt = now;
	}

	const task =
		mode === "author"
			? "Create the complete test suite for this slice. Prove RED for the intended missing production behavior."
			: "Revise the existing tests to address every review gap below. Do not implement production code. Re-run the targeted tests and prove the revised RED state.";
	const prompt = [
		contract,
		`\n# Invocation\n\nSlice ID: ${id}\nMode: ${mode}\n${task}`,
		`\n# Requirements brief\n\n${brief}`,
		feedback ? `\n# Lead scrutiny feedback\n\n${feedback}` : "",
	].join("\n");

	const [before, testsBefore] = await Promise.all([
		snapshotProtectedFiles(),
		snapshotTestFiles(),
	]);
	const claudeArgs = [
		"-p",
		"--model",
		"sonnet",
		"--effort",
		"high",
		"--permission-mode",
		"acceptEdits",
		"--output-format",
		"json",
		"--allowedTools",
		"Read",
		"Glob",
		"Grep",
		"Edit",
		"Write",
		"Bash(bun test *)",
		"Bash(bun run test *)",
		"Bash(bun run test:e2e *)",
		"Bash(bun run --cwd frontend test *)",
		"Bash(bunx @biomejs/biome lint *)",
		"Bash(git diff *)",
		"Bash(git status *)",
		"--disallowedTools",
		"Agent",
		...(mode === "author"
			? ["--session-id", state.sessionId]
			: ["--resume", state.sessionId]),
		prompt,
	];
	const claude = Bun.spawn(["claude", ...claudeArgs], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			CLAUDE_CODE_SUBAGENT_MODEL: "sonnet",
			CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
		},
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(claude.stdout).text(),
		new Response(claude.stderr).text(),
		claude.exited,
	]);

	await writeFile(
		responsePath,
		stdout || JSON.stringify({ stderr, exitCode }, null, 2),
		"utf8",
	);
	const [after, testsAfter] = await Promise.all([
		snapshotProtectedFiles(),
		snapshotTestFiles(),
	]);
	const boundaryViolations = changedProtectedFiles(before, after);
	if (boundaryViolations.length) {
		throw new Error(
			`Claude changed files outside tests/ or frontend/e2e/. Inspect and restore deliberately; the launcher will not discard work:\n${boundaryViolations.map((path) => `- ${path}`).join("\n")}`,
		);
	}
	if (exitCode !== 0)
		throw new Error(`Claude Code exited ${exitCode}: ${stderr.trim()}`);
	const changedTests = changedProtectedFiles(testsBefore, testsAfter);
	if (!changedTests.length) {
		throw new Error(
			"Claude did not add or revise any test files for this invocation",
		);
	}

	let result: ClaudeResult;
	try {
		result = JSON.parse(stdout) as ClaudeResult;
	} catch {
		throw new Error(
			`Claude did not return valid JSON. Raw output is in ${relative(repoRoot, responsePath)}`,
		);
	}
	const modelUsage = result.modelUsage ?? result.model_usage ?? {};
	const modelIds = Object.keys(modelUsage);
	const sonnet5Model = modelIds.find((model) => /sonnet[-_ ]?5/i.test(model));
	if (!sonnet5Model) {
		throw new Error(
			`Expected Claude Sonnet 5, but response reported: ${modelIds.join(", ") || "no model identity"}`,
		);
	}

	state.sessionId = String(result.session_id ?? state.sessionId);
	state.model = sonnet5Model;
	state.testFiles = [
		...new Set([...(state.testFiles ?? []), ...changedTests]),
	].sort();
	await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	const summary = typeof result.result === "string" ? result.result : stdout;
	console.log(summary.trim());
	console.log(`\nClaude Sonnet 5 session: ${state.sessionId}`);
	console.log(`Slice tests: ${state.testFiles.join(", ")}`);
	console.log(
		`Transient response: ${normalizeRepoPath(relative(repoRoot, responsePath))}`,
	);
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
