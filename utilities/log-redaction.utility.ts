/**
 * Redaction for anything about to be logged.
 *
 * The defect this exists for: `preview-generator.utility.ts` logged its whole
 * axios config, and preview resolves protected values before building the
 * request — so live `Authorization` headers and proxy credentials went to
 * stdout on every preview. A one-off `password: "[REDACTED]"` fix existed at a
 * single call site and generalised to nothing.
 *
 * Two properties matter as much as hiding secrets:
 *
 * - The result must stay diagnostically useful. A redactor that returns an
 *   empty object is safe and worthless; hosts, feed ids and status codes have
 *   to survive.
 * - It must never throw. Logging usually happens on the error path, so a
 *   redactor that crashes turns a recoverable failure into a lost one.
 */

/**
 * Substring "redact" is the contract callers and tests rely on, not this exact
 * spelling. Deliberately not exported: nothing outside this module needs it,
 * and the fallow unused-export gate is right to reject a wider surface than
 * the one actually in use.
 */
const REDACTED = "[REDACTED]";

/**
 * Depth cap. Guards against both cycles and pathologically deep structures —
 * a 5000-deep chain must not blow the stack while trying to hide a secret.
 */
const MAX_DEPTH = 12;

/** Beyond this, arrays are summarised. Bounds log size on 10k-entry payloads. */
const MAX_ARRAY_ENTRIES = 100;

/** Beyond this, strings are truncated; long bodies are rarely worth logging whole. */
const MAX_STRING_LENGTH = 2000;

/**
 * Field names whose values are secret.
 *
 * Deliberately anchored on whole, meaningful fragments rather than loose
 * substrings: matching a bare "auth" would redact `author`, and matching a
 * bare "key" would redact `keyword` and `apiKeyName`. Over-redaction destroys
 * the diagnostic value this utility exists to preserve.
 */
const SENSITIVE_KEY = new RegExp(
	[
		"pass(word|key|phrase)?",
		"secret",
		"token",
		"api[-_ ]?key",
		"encryption[-_ ]?key",
		"private[-_ ]?key",
		"access[-_ ]?key",
		"authorization",
		// Deliberately not a bare "auth": an `auth` field is normally a
		// container (`proxy.auth = { username, password }`), so redacting it
		// whole would hide the username that makes the log useful while the
		// password inside is already covered by its own name.
		"set[-_ ]?cookie",
		"^cookies?$",
		"credential",
		"bearer",
	].join("|"),
	"i",
);

/**
 * Userinfo in a URL: `scheme://user:pass@host`. Requires a scheme and a colon
 * before the `@` so an ordinary email address is left alone — over-eager
 * rewriting here is the obvious way to make logs wrong rather than safe.
 */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]*)@/gi;

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY.test(key);
}

/** Strips credentials from any URL embedded in a string, leaving the rest intact. */
function redactString(value: string): string {
	const stripped = value.replace(URL_USERINFO, `$1${REDACTED}@`);
	return stripped.length > MAX_STRING_LENGTH
		? `${stripped.slice(0, MAX_STRING_LENGTH)}…[truncated ${stripped.length - MAX_STRING_LENGTH} chars]`
		: stripped;
}

/** A `{ type: "protected", value }` protected value, in either direction. */
function isProtectedValueShape(value: object): boolean {
	const v = value as { type?: unknown };
	return v.type === "protected" || v.type === "env";
}

/**
 * A resolved AES-256-GCM envelope from `security.utility.ts`. Logging one
 * reveals nothing useful and confirms which values exist, so it goes whole.
 */
function isEnvelopeShape(value: object): boolean {
	const v = value as { v?: unknown; iv?: unknown; tag?: unknown; ct?: unknown };
	return (
		typeof v.v === "number" &&
		typeof v.iv === "string" &&
		typeof v.tag === "string" &&
		typeof v.ct === "string"
	);
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
	const out: Record<string, unknown> = {
		name: error.name,
		message: redactString(error.message),
	};
	if (error.stack) out.stack = redactString(error.stack);
	if (error.cause !== undefined) out.cause = walk(error.cause, depth + 1, seen);
	// Own enumerable properties can carry anything the thrower attached.
	for (const [key, value] of Object.entries(error)) {
		out[key] = isSensitiveKey(key) ? REDACTED : walk(value, depth + 1, seen);
	}
	return out;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
	if (value === null || value === undefined) return value;

	if (typeof value === "string") return redactString(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return value;
	}
	if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
	if (typeof value === "symbol") return value.toString();

	if (typeof value !== "object") return String(value);

	// Dates stay recognizable: they serialize to their ISO string.
	if (value instanceof Date) return value;
	if (value instanceof RegExp) return value.toString();

	if (depth >= MAX_DEPTH) return "[Object depth limit reached]";

	// A cycle, or the same object twice. Returning a marker keeps the result
	// JSON-serializable, which a logger downstream will assume.
	if (seen.has(value)) return "[Circular]";
	seen.add(value);

	try {
		if (value instanceof Error) return redactError(value, depth, seen);

		if (Array.isArray(value)) {
			const shown = value.slice(0, MAX_ARRAY_ENTRIES).map((item) => walk(item, depth + 1, seen));
			if (value.length > MAX_ARRAY_ENTRIES) {
				shown.push(`[… ${value.length - MAX_ARRAY_ENTRIES} more entries]`);
			}
			return shown;
		}

		if (value instanceof Map) {
			const out: Record<string, unknown> = {};
			let i = 0;
			for (const [key, entry] of value) {
				if (i++ >= MAX_ARRAY_ENTRIES) {
					out["[…]"] = `${value.size - MAX_ARRAY_ENTRIES} more entries`;
					break;
				}
				const name = typeof key === "string" ? key : String(key);
				out[name] = isSensitiveKey(name) ? REDACTED : walk(entry, depth + 1, seen);
			}
			return out;
		}

		if (value instanceof Set) {
			return walk([...value].slice(0, MAX_ARRAY_ENTRIES), depth + 1, seen);
		}

		if (isProtectedValueShape(value) || isEnvelopeShape(value)) return REDACTED;

		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = isSensitiveKey(key) ? REDACTED : walk(entry, depth + 1, seen);
		}
		return out;
	} finally {
		// Released so the same object appearing twice in sibling branches is
		// rendered rather than reported as circular.
		seen.delete(value);
	}
}

/**
 * Returns a copy of `value` safe to log. Never mutates the input, never
 * throws, and always returns something JSON-serializable.
 */
export function redact(value: unknown): unknown {
	try {
		return walk(value, 0, new WeakSet<object>());
	} catch {
		// A getter that throws, an exotic proxy — logging must still happen.
		return "[unredactable value omitted]";
	}
}
