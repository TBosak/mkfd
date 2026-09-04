import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type LockFile = {
	id: string;
	createdAt: string;
	files: Record<string, string>;
};

const repoRoot = resolve(import.meta.dir, "..");
const stateDir = resolve(repoRoot, ".tdd-state");

function option(name: string): string | undefined {
	const args = Bun.argv.slice(2);
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function normalize(path: string): string {
	return path.replaceAll("\\", "/");
}

function isAcceptedTestPath(path: string): boolean {
	const normalized = normalize(path);
	return (
		normalized.length > 0 &&
		!normalized.startsWith("/") &&
		!/^[a-z]:\//i.test(normalized) &&
		!normalized
			.split("/")
			.some((segment) => segment === ".." || segment === "") &&
		(normalized.startsWith("tests/") || normalized.startsWith("frontend/e2e/"))
	);
}

async function listTests(): Promise<string[]> {
	const process = Bun.spawn(
		["git", "ls-files", "-co", "--exclude-standard", "-z"],
		{
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) throw new Error(stderr.trim());
	return [
		...new Set(
			stdout
				.split("\0")
				.filter(Boolean)
				.map(normalize)
				.filter(isAcceptedTestPath),
		),
	].sort();
}

async function digest(path: string): Promise<string> {
	const bytes = await Bun.file(resolve(repoRoot, path)).arrayBuffer();
	return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function snapshot(paths: string[]): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const current = new Set(await listTests());
	for (const path of paths) {
		if (current.has(path)) result[path] = await digest(path);
		else result[path] = "<missing>";
	}
	return result;
}

function changes(
	expected: Record<string, string>,
	actual: Record<string, string>,
): string[] {
	const paths = new Set([...Object.keys(expected), ...Object.keys(actual)]);
	return [...paths].filter((path) => expected[path] !== actual[path]).sort();
}

async function main(): Promise<void> {
	const mode = Bun.argv[2];
	const id = option("--id");
	if ((mode !== "lock" && mode !== "verify") || !id) {
		throw new Error(
			"Usage: bun run tdd:tests -- <lock|verify> --id <slice-id>",
		);
	}
	if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) {
		throw new Error("--id must be 3-80 lowercase letters, numbers, or hyphens");
	}

	await mkdir(stateDir, { recursive: true });
	const lockPath = resolve(stateDir, `${id}-test-lock.json`);
	if (mode === "lock") {
		const explicitFiles = option("--files")
			?.split(",")
			.map((path) => normalize(path.trim()))
			.filter(Boolean);
		const sessionPath = resolve(stateDir, `${id}.json`);
		const session = explicitFiles?.length
			? undefined
			: (JSON.parse(
					await readFile(sessionPath, "utf8").catch(() => {
						throw new Error(
							`No Claude session state found for ${id}; pass --files or run tdd:claude first`,
						);
					}),
				) as { testFiles?: string[] });
		const selected = [
			...new Set(
				explicitFiles?.length ? explicitFiles : (session?.testFiles ?? []),
			),
		].sort();
		if (!selected.length)
			throw new Error(`No slice test files found for ${id}`);
		const invalid = selected.filter((path) => !isAcceptedTestPath(path));
		if (invalid.length)
			throw new Error(
				`Only tests/ and frontend/e2e/ may be locked:\n${invalid.join("\n")}`,
			);
		const files = await snapshot(selected);
		const missing = Object.entries(files)
			.filter(([, hash]) => hash === "<missing>")
			.map(([path]) => path);
		if (missing.length)
			throw new Error(`Cannot lock missing test files:\n${missing.join("\n")}`);
		const lock: LockFile = { id, createdAt: new Date().toISOString(), files };
		await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
		console.log(
			`Locked ${Object.keys(lock.files).length} test files for ${id}.`,
		);
		return;
	}

	const lock = JSON.parse(
		await readFile(lockPath, "utf8").catch(() => {
			throw new Error(
				`No test lock exists for ${id}; run lock after test scrutiny`,
			);
		}),
	) as LockFile;
	const changed = changes(lock.files, await snapshot(Object.keys(lock.files)));
	if (changed.length) {
		throw new Error(
			`Accepted tests changed during implementation:\n${changed.map((path) => `- ${path}`).join("\n")}`,
		);
	}
	console.log(
		`Verified ${Object.keys(lock.files).length} accepted test files unchanged for ${id}.`,
	);
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
