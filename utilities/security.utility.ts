import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Current protected-value envelope version. Bump only alongside a reader that
 * still understands every earlier version, or stored secrets become
 * unreadable.
 */
const ENVELOPE_VERSION = 1;

/** AES-256-GCM's standard IV size. 96 bits is the size GCM is defined for. */
const IV_BYTES = 12;

/** The placeholder that used to ship as a docker-compose default. */
const PLACEHOLDER_KEY = "your_encryption_key_here";

/** A key shorter than this cannot plausibly carry 256 bits of entropy. */
const MIN_PRODUCTION_KEY_LENGTH = 32;

/** A legacy value is bare base64 with no structure of its own. */
const LEGACY_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

interface Envelope {
	v: number;
	iv: string;
	tag: string;
	ct: string;
}

/**
 * Refuses a key that cannot be used at all, with a message naming the problem
 * rather than letting the failure surface as an incidental crash from inside
 * the cipher library. Callers in routes and workers wrap their crypto calls,
 * so throwing here fails one request or one feed update cleanly.
 */
function assertUsableKey(encryptionKey: string | undefined | null): asserts encryptionKey is string {
	if (typeof encryptionKey !== "string" || encryptionKey.length === 0) {
		throw new Error(
			"Encryption key is missing. Set ENCRYPTION_KEY to a random 32-byte secret; " +
				"protected values cannot be read or written without it.",
		);
	}
}

/**
 * Derives the AES key from the whole configured secret.
 *
 * The pre-v3 code took the first 32 raw UTF-8 bytes, so two keys sharing a
 * 32-byte prefix were interchangeable and a short key silently produced a
 * short AES key. Hashing uses every byte of the secret and always yields
 * exactly 256 bits, whatever the operator supplied.
 */
function deriveKey(encryptionKey: string): Buffer {
	return createHash("sha256").update(encryptionKey, "utf8").digest();
}

/**
 * Legacy key derivation, preserved byte-for-byte so existing values stay
 * readable: the pre-v3 code took the first 32 raw UTF-8 bytes of the secret.
 */
function deriveLegacyKey(encryptionKey: string): Buffer {
	const bytes = Buffer.from(encryptionKey, "utf8").subarray(0, 32);
	if (bytes.length < 32) {
		throw new Error(
			`Encryption key is too short to read legacy values (${bytes.length} of 32 bytes). ` +
				"The key that wrote them must be supplied in full.",
		);
	}
	return bytes;
}

function isEnvelope(value: unknown): value is Envelope {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as Envelope).v === "number" &&
		typeof (value as Envelope).iv === "string" &&
		typeof (value as Envelope).tag === "string" &&
		typeof (value as Envelope).ct === "string"
	);
}

/**
 * Validates an encryption key for use at startup.
 *
 * Production fails closed: an absent, placeholder, or too-short key stops the
 * process with an actionable message rather than silently encrypting every
 * stored secret under something guessable. Outside production the ergonomics
 * are looser so a scratch key still works for local development, but a key
 * that is absent entirely is refused everywhere, since nothing can be
 * encrypted without one.
 */
export function assertValidEncryptionKey(encryptionKey: string | undefined | null): void {
	assertUsableKey(encryptionKey);

	if (process.env.NODE_ENV !== "production") return;

	if (encryptionKey === PLACEHOLDER_KEY) {
		throw new Error(
			"Encryption key is the shipped placeholder value. Set ENCRYPTION_KEY to a " +
				"unique random 32-byte secret before running in production; the placeholder " +
				"is public and every value encrypted under it is readable by anyone.",
		);
	}

	if (encryptionKey.length < MIN_PRODUCTION_KEY_LENGTH) {
		throw new Error(
			`Encryption key is too short (${encryptionKey.length} characters). Set ENCRYPTION_KEY ` +
				`to at least ${MIN_PRODUCTION_KEY_LENGTH} characters of random material so it can ` +
				"carry 256 bits of entropy.",
		);
	}
}

/** True when the value was written by the current AES-256-GCM path. */
export function isCurrentFormat(value: string): boolean {
	if (typeof value !== "string" || !value.startsWith("{")) return false;
	try {
		const parsed = JSON.parse(value);
		return isEnvelope(parsed) && parsed.v === ENVELOPE_VERSION;
	} catch {
		return false;
	}
}

/**
 * Seals a value with AES-256-GCM. The authentication tag covers the
 * ciphertext and the version identifier, so tampering with any part of the
 * envelope is detected on read instead of yielding altered plaintext.
 */
export function encrypt(text: string, encryptionKey: string): string {
	assertUsableKey(encryptionKey);

	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionKey), iv);
	cipher.setAAD(Buffer.from(String(ENVELOPE_VERSION), "utf8"));

	const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);

	const envelope: Envelope = {
		v: ENVELOPE_VERSION,
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		ct: ct.toString("base64"),
	};
	return JSON.stringify(envelope);
}

/**
 * Reads a protected value in either format.
 *
 * Failure modes are deliberately distinguishable: an envelope that does not
 * authenticate reports an integrity/key failure, while a string that is not a
 * recognizable envelope at all reports a format failure. Operators debugging a
 * rotation need to tell "wrong key" from "corrupt data", and the pre-v3 code
 * could tell them apart only by accident.
 */
export function decrypt(encryptedText: string, encryptionKey: string): string {
	assertUsableKey(encryptionKey);

	if (typeof encryptedText === "string" && encryptedText.startsWith("{")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(encryptedText);
		} catch {
			throw new Error(
				"Protected value is not a readable envelope: it begins like JSON but does not parse.",
			);
		}
		if (!isEnvelope(parsed)) {
			throw new Error(
				"Protected value is not a readable envelope: missing one of the v/iv/tag/ct fields.",
			);
		}
		if (parsed.v !== ENVELOPE_VERSION) {
			throw new Error(
				`Protected value declares unsupported envelope version ${parsed.v}; ` +
					`this build understands version ${ENVELOPE_VERSION}. Refusing to guess at its contents.`,
			);
		}

		try {
			const decipher = createDecipheriv(
				"aes-256-gcm",
				deriveKey(encryptionKey),
				Buffer.from(parsed.iv, "base64"),
			);
			decipher.setAAD(Buffer.from(String(parsed.v), "utf8"));
			decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
			return Buffer.concat([
				decipher.update(Buffer.from(parsed.ct, "base64")),
				decipher.final(),
			]).toString("utf8");
		} catch {
			throw new Error(
				"Protected value failed authentication: the encryption key is wrong, or the " +
					"stored value has been modified since it was written.",
			);
		}
	}

	if (typeof encryptedText === "string" && LEGACY_BASE64.test(encryptedText)) {
		return decryptLegacy(encryptedText, encryptionKey);
	}

	throw new Error(
		"Protected value is not a readable envelope: it is neither a versioned " +
			"envelope nor a legacy base64 value.",
	);
}

/**
 * Reads a pre-v3 AES-CBC value.
 *
 * Deliberately does NOT trim the result. The pre-v3 implementation ended in
 * `.trim()`, silently corrupting every stored secret with leading or trailing
 * whitespace; preserving that here would carry the corruption through the
 * migration.
 */
function decryptLegacy(encryptedText: string, encryptionKey: string): string {
	const raw = Buffer.from(encryptedText, "base64");
	if (raw.length <= 16) {
		throw new Error(
			"Protected value failed to decrypt in the legacy format: it is too short to " +
				"contain an initialisation vector and a ciphertext block.",
		);
	}

	// Decrypted with node:crypto rather than node-forge deliberately. The
	// legacy format is unauthenticated, so a wrong key is caught only by the
	// PKCS#7 padding check — and forge's is lenient enough that a wrong key is
	// accepted roughly one time in five, usually yielding an empty string,
	// which the pre-v3 code then returned as if it were the secret. node's
	// CBC validates the full padding and throws, cutting that to the residual
	// rate inherent in an unauthenticated cipher. Requiring well-formed UTF-8
	// on top removes most of what remains. Only the AES-GCM format can
	// actually prove a value's integrity, which is why migration exists — but
	// this must never silently hand back garbage, above all during rotation,
	// where that would re-encrypt nonsense over a real secret.
	let plaintext: Buffer;
	try {
		const decipher = createDecipheriv("aes-256-cbc", deriveLegacyKey(encryptionKey), raw.subarray(0, 16));
		plaintext = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
	} catch {
		throw new Error(
			"Protected value failed to decrypt in the legacy format: the encryption key is " +
				"wrong, or the stored value is corrupted.",
		);
	}

	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
	} catch {
		throw new Error(
			"Protected value failed to decrypt in the legacy format: the decrypted bytes are " +
				"not valid UTF-8, so the encryption key is wrong or the stored value is corrupted.",
		);
	}
}
