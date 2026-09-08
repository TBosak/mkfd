/**
 * Synchronous access to stored settings, for the runtime consumers that
 * enforce them.
 *
 * Three settings were declared in `SETTING_REGISTRY`, editable through the
 * API and stored in `app_settings` — and nothing read them. The outbound
 * policy built its options straight from `process.env`, so an operator could
 * turn "allow private fetches" on, see it saved, reload and see it still
 * saved, while the policy went on refusing private addresses. The setting
 * appeared to work. For a control that governs whether SSRF protection can be
 * relaxed, that is worse than not offering it.
 *
 * Why synchronous: `getGlobalFetchPolicyOptions()` is used as a *default
 * parameter value* at several call sites, and an accepted locked test calls
 * it synchronously. Making it async would ripple through every caller and
 * break a frozen contract, so this reads through bun:sqlite's synchronous
 * query API instead.
 */

import { getDb } from "../lib/analytics/db";
import { parseRawValue, SETTING_REGISTRY, type SettingValue } from "./app-settings.utility";

/**
 * What the stored layer had to say.
 *
 * `unavailable` is deliberately distinct from an empty `values`: a database
 * that cannot be read is not the same as one holding no rows, and the two
 * must lead to different fallbacks.
 */
type StoredSettings =
	| { state: "degraded" }
	| { state: "uninitialised" }
	| { state: "ok"; values: Record<string, string> };

/**
 * Reads the stored settings, distinguishing three states.
 *
 * `degraded` and `uninitialised` are deliberately separate. A database that
 * was opened and cannot be read has *failed*, and a security control whose
 * storage has failed must fail closed — that is what the locked
 * `p3-settings-runtime-consumers` suite pins, using a genuinely corrupt file.
 *
 * A database that was never opened at all is a different situation: a CLI
 * script, a worker before `initDb`, or a unit test that has no reason to
 * stand up SQLite. Treating that as failure would silently ignore the
 * environment in every one of those contexts, which is how the previously
 * working env-var configuration would quietly stop applying.
 */
function readStoredSettings(): StoredSettings {
	let db: ReturnType<typeof getDb>;
	try {
		db = getDb();
	} catch {
		return { state: "uninitialised" };
	}
	try {
		const rows = db
			.query("SELECT key, value FROM app_settings")
			.all() as Array<{ key: string; value: string }>;
		return { state: "ok", values: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
	} catch {
		// Opened, but unreadable: corrupt, mid-migration, schema missing.
		return { state: "degraded" };
	}
}

/**
 * Deserializes a stored or environment value using the registry's own parser.
 *
 * Deliberately `parseRawValue` rather than a local switch: `string[]` is
 * stored as JSON in the database but supplied comma-separated in an
 * environment variable, and only that function knows both encodings. A second
 * deserializer here silently dropped every allowlist entry read from the
 * database, because it split a JSON array on commas.
 */
function coerce(raw: string, key: string): SettingValue | undefined {
	const meta = SETTING_REGISTRY[key];
	if (!meta) return undefined;
	const parsed = parseRawValue(meta, raw);
	if (meta.type === "number" && !Number.isFinite(parsed as number)) return undefined;
	return parsed;
}

/**
 * Resolves one setting: stored beats environment beats registry default.
 *
 * When the store is unreadable this returns `safeFallback` and ignores the
 * environment entirely. That asymmetry is the point of requirement 6: a
 * security control whose storage has failed must fail closed, and honouring
 * `ALLOW_PRIVATE_FETCHES=true` from the environment at exactly the moment the
 * app has lost track of its own configuration is the opposite of that.
 */
export function effectiveSetting(key: string, safeFallback: SettingValue): SettingValue {
	const meta = SETTING_REGISTRY[key];
	const stored = readStoredSettings();

	// Failed storage fails closed; absent storage falls through to the
	// environment, which is where configuration lives before a database does.
	if (stored.state === "degraded") return safeFallback;

	if (stored.state === "ok") {
		const rawStored = stored.values[key];
		if (rawStored !== undefined) {
			const coerced = coerce(rawStored, key);
			if (coerced !== undefined) return coerced;
		}
	}

	if (meta?.envVar) {
		const rawEnv = process.env[meta.envVar];
		if (rawEnv !== undefined && rawEnv !== "") {
			const coerced = coerce(rawEnv, key);
			if (coerced !== undefined) return coerced;
		}
	}

	return (meta?.defaultValue as SettingValue | undefined) ?? safeFallback;
}
