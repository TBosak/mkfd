/**
 * Migrates stored protected values to the current AES-256-GCM envelope, and
 * rotates them to a new encryption key.
 *
 * Deliberately a CLI entry point rather than a startup step or an HTTP route.
 * Rewriting every stored secret is hard to reverse, so it happens when an
 * operator asks for it — not automatically on boot, where a wrong key would
 * touch the whole store on an ordinary restart.
 *
 *   bun run migrate:protected-values
 *   bun run migrate:protected-values -- --dir ./configs
 *   bun run migrate:protected-values -- --rotate --new-key <new-key>
 */
import { join } from "node:path";
import {
	migrateProtectedValueStore,
	rotateProtectedValueStore,
	type UnreadableValue,
} from "../utilities/protected-value-migration.utility";
import { assertValidEncryptionKey } from "../utilities/security.utility";

function flag(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function reportUnreadable(unreadable: UnreadableValue[]): void {
	if (unreadable.length === 0) return;
	console.warn(
		`\n${unreadable.length} value(s) could not be read and were left untouched. ` +
			"They were not dropped or overwritten; supply the key that wrote them and re-run.",
	);
	for (const item of unreadable) {
		console.warn(`  ${item.file} ${item.path}: ${item.error}`);
	}
}

const configsDir = flag("dir") ?? join(import.meta.dir, "..", "configs");
const encryptionKey = process.env.ENCRYPTION_KEY ?? "";
assertValidEncryptionKey(encryptionKey);

if (process.argv.includes("--rotate")) {
	const newKey = flag("new-key");
	if (!newKey) {
		console.error("--rotate requires --new-key <key>. Nothing was changed.");
		process.exit(1);
	}
	assertValidEncryptionKey(newKey);

	const report = await rotateProtectedValueStore(configsDir, encryptionKey, newKey);
	console.log(
		`Rotated ${report.rotatedValues} value(s) across ${report.rotatedFiles.length} of ` +
			`${report.scannedFiles.length} scanned file(s) in ${configsDir}.`,
	);
	reportUnreadable(report.unreadable);
	console.log("\nSet ENCRYPTION_KEY to the new key before restarting.");
} else {
	const report = await migrateProtectedValueStore(configsDir, encryptionKey);
	console.log(
		`Migrated ${report.migratedValues} value(s) across ${report.migratedFiles.length} of ` +
			`${report.scannedFiles.length} scanned file(s) in ${configsDir}.`,
	);
	reportUnreadable(report.unreadable);
}
