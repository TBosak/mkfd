import { encrypt, decrypt } from "./security.utility";
import type { ProtectedValue } from "../models/protected-value.model";

export function isProtectedValue(value: unknown): value is ProtectedValue {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    ((value as { type?: unknown }).type === "protected" ||
      (value as { type?: unknown }).type === "env")
  );
}

export function protectValue(
  plaintext: string,
  encryptionKey: string,
): ProtectedValue & { type: "protected" } {
  return { type: "protected", value: encrypt(plaintext, encryptionKey) };
}

export function envValue(
  varName: string,
  prefix?: string,
): ProtectedValue & { type: "env" } {
  return { type: "env", value: varName, prefix };
}

export function resolveProtectedValue(pv: ProtectedValue, encryptionKey: string): string {
  if (pv.type === "env") {
    const resolved = process.env[pv.value];
    if (!resolved) throw new Error(`Missing environment variable: ${pv.value}`);
    return `${pv.prefix ?? ""}${resolved}`;
  }
  return decrypt(pv.value, encryptionKey);
}

export function resolveProtectedValues<T>(
  input: T,
  options: { encryptionKey: string },
): T {
  if (isProtectedValue(input)) {
    return resolveProtectedValue(input, options.encryptionKey) as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => resolveProtectedValues(item, options)) as T;
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveProtectedValues(v, options),
      ]),
    ) as T;
  }
  return input;
}
