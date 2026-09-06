import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { decrypt, encrypt, isCurrentFormat } from "./security.utility";
import { isProtectedValue } from "./protected-values.utility";

/** One value that could not be read, left exactly as it was found. */
export interface UnreadableValue {
	file: string;
	path: string;
	error: string;
}

export interface MigrationReport {
	scannedFiles: string[];
	migratedFiles: string[];
	migratedValues: number;
	unreadable: UnreadableValue[];
}

export interface RotationReport {
	scannedFiles: string[];
	rotatedFiles: string[];
	rotatedValues: number;
	unreadable: UnreadableValue[];
}

/**
 * Outcome of considering one stored value: rewrite it, leave it alone, or
 * report it as unreadable. Nothing is ever dropped — an unreadable secret is
 * left untouched, because losing it is worse than failing to migrate it.
 */
type ValueOutcome =
	| { kind: "rewrite"; value: string }
	| { kind: "skip" }
	| { kind: "unreadable"; error: string };

/** Feed configs are YAML, per utilities/config-manager.utility.ts. */
function isConfigFile(name: string): boolean {
	return name.endsWith(".yaml") || name.endsWith(".yml");
}

/**
 * Walks a parsed config, applying `consider` to every `protected` value.
 * Returns the rewritten tree and what happened, without mutating the input.
 */
function transformProtectedValues(
	node: unknown,
	consider: (value: string, path: string) => ValueOutcome,
	path: string,
	changes: { rewritten: number; unreadable: Array<{ path: string; error: string }> },
): unknown {
	if (isProtectedValue(node)) {
		// `env` values name an environment variable; they never touch the cipher.
		if (node.type !== "protected") return node;

		const outcome = consider(node.value, path);
		if (outcome.kind === "rewrite") {
			changes.rewritten += 1;
			return { ...node, value: outcome.value };
		}
		if (outcome.kind === "unreadable") {
			changes.unreadable.push({ path, error: outcome.error });
		}
		return node;
	}

	if (Array.isArray(node)) {
		return node.map((item, i) => transformProtectedValues(item, consider, `${path}[${i}]`, changes));
	}

	if (node && typeof node === "object") {
		return Object.fromEntries(
			Object.entries(node as Record<string, unknown>).map(([key, value]) => [
				key,
				transformProtectedValues(value, consider, `${path}.${key}`, changes),
			]),
		);
	}

	return node;
}

/**
 * Applies `consider` across every config file in `configsDir`, rewriting only
 * the files that actually changed. A file with nothing to do is never
 * rewritten, so an unreadable value's file stays byte-for-byte identical and
 * a second run over an already-processed store is a no-op.
 */
async function processStore(
	configsDir: string,
	consider: (value: string, path: string) => ValueOutcome,
): Promise<{
	scannedFiles: string[];
	changedFiles: string[];
	changedValues: number;
	unreadable: UnreadableValue[];
}> {
	const entries = await readdir(configsDir);
	const scannedFiles: string[] = [];
	const changedFiles: string[] = [];
	const unreadable: UnreadableValue[] = [];
	let changedValues = 0;

	for (const entry of entries.filter(isConfigFile).sort()) {
		const file = join(configsDir, entry);
		const raw = await readFile(file, "utf8");

		let parsed: unknown;
		try {
			parsed = yaml.load(raw);
		} catch (err) {
			unreadable.push({ file, path: "$", error: `Config is not valid YAML: ${asMessage(err)}` });
			continue;
		}
		scannedFiles.push(file);

		const changes = { rewritten: 0, unreadable: [] as Array<{ path: string; error: string }> };
		const next = transformProtectedValues(parsed, consider, "$", changes);

		for (const item of changes.unreadable) {
			unreadable.push({ file, path: item.path, error: item.error });
		}

		if (changes.rewritten > 0) {
			await writeFile(file, yaml.dump(next), "utf8");
			changedFiles.push(file);
			changedValues += changes.rewritten;
		}
	}

	return { scannedFiles, changedFiles, changedValues, unreadable };
}

function asMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Rewrites every legacy AES-CBC protected value in the store as AES-256-GCM.
 *
 * Idempotent: a value already in the current format is left alone, so the file
 * is not rewritten and a second run reports nothing migrated. A value that
 * cannot be decrypted is reported and left exactly as found.
 */
export async function migrateProtectedValueStore(
	configsDir: string,
	encryptionKey: string,
): Promise<MigrationReport> {
	const result = await processStore(configsDir, (value) => {
		if (isCurrentFormat(value)) return { kind: "skip" };
		try {
			return { kind: "rewrite", value: encrypt(decrypt(value, encryptionKey), encryptionKey) };
		} catch (err) {
			return { kind: "unreadable", error: asMessage(err) };
		}
	});

	return {
		scannedFiles: result.scannedFiles,
		migratedFiles: result.changedFiles,
		migratedValues: result.changedValues,
		unreadable: result.unreadable,
	};
}

/**
 * Re-encrypts every readable protected value from `oldKey` to `newKey`.
 *
 * Values readable under the old key are rotated whether they are legacy or
 * current format. A value already readable under the new key is treated as
 * already rotated and skipped, which makes re-running the same rotation a
 * no-op. Anything readable under neither key is reported and left untouched —
 * never silently re-encrypted under the new key, which would destroy it.
 */
export async function rotateProtectedValueStore(
	configsDir: string,
	oldKey: string,
	newKey: string,
): Promise<RotationReport> {
	const result = await processStore(configsDir, (value) => {
		let plaintext: string;
		try {
			plaintext = decrypt(value, oldKey);
		} catch (oldKeyError) {
			try {
				decrypt(value, newKey);
				return { kind: "skip" };
			} catch {
				return { kind: "unreadable", error: asMessage(oldKeyError) };
			}
		}
		return { kind: "rewrite", value: encrypt(plaintext, newKey) };
	});

	return {
		scannedFiles: result.scannedFiles,
		rotatedFiles: result.changedFiles,
		rotatedValues: result.changedValues,
		unreadable: result.unreadable,
	};
}
