import { resolve } from "node:path";

type QualityTask =
	| "lint"
	| "lint-root"
	| "lint-frontend"
	| "typecheck"
	| "typecheck-root"
	| "typecheck-frontend";

type Command = readonly string[];

const repoRoot = resolve(import.meta.dir, "..");
const task = Bun.argv[2] as QualityTask | undefined;
const forwardedArgs = Bun.argv.slice(3).filter((argument) => argument !== "--");

const lintRoot: Command = [
	"bunx",
	"@biomejs/biome",
	"lint",
	".",
	"--config-path",
	"biome.root.json",
	...forwardedArgs,
];
const lintFrontend: Command = [
	"bunx",
	"@biomejs/biome",
	"lint",
	"frontend",
	"--config-path",
	"biome.json",
	...forwardedArgs,
];
const lintAll: Command = [
	"bunx",
	"@biomejs/biome",
	"lint",
	".",
	"--config-path",
	"biome.json",
	...forwardedArgs,
];
const typecheckRoot: Command = [
	"bunx",
	"tsc",
	"--noEmit",
	"-p",
	"tsconfig.json",
	...forwardedArgs,
];
const typecheckFrontendApp: Command = [
	"bunx",
	"tsc",
	"--noEmit",
	"-p",
	"frontend/tsconfig.json",
	...forwardedArgs,
];
const typecheckFrontendE2E: Command = [
	"bunx",
	"tsc",
	"--noEmit",
	"-p",
	"frontend/tsconfig.e2e.json",
	...forwardedArgs,
];

const commandsByTask: Record<QualityTask, Command[]> = {
	"lint-root": [lintRoot],
	"lint-frontend": [lintFrontend],
	lint: [lintAll],
	"typecheck-root": [typecheckRoot],
	"typecheck-frontend": [typecheckFrontendApp, typecheckFrontendE2E],
	typecheck: [typecheckRoot, typecheckFrontendApp, typecheckFrontendE2E],
};

if (!task || !(task in commandsByTask)) {
	console.error(
		"Usage: bun scripts/run-quality.ts <lint|lint-root|lint-frontend|typecheck|typecheck-root|typecheck-frontend> [tool arguments]",
	);
	process.exit(2);
}

let exitCode = 0;
for (const command of commandsByTask[task]) {
	const child = Bun.spawn([...command], {
		cwd: repoRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const childExitCode = await child.exited;
	if (childExitCode !== 0 && exitCode === 0) exitCode = childExitCode;
}

process.exit(exitCode);
