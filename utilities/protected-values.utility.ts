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
  suffix?: string,
): ProtectedValue & { type: "env" } {
  return { type: "env", value: varName, prefix, suffix };
}

export function resolveProtectedValue(pv: ProtectedValue, encryptionKey: string): string {
  if (pv.type === "env") {
    const resolved = process.env[pv.value];
    if (!resolved) throw new Error(`Missing environment variable: ${pv.value}`);
    return `${pv.prefix ?? ""}${resolved}${pv.suffix ?? ""}`;
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

export function maskProtectedValues<T>(input: T): T {
  if (isProtectedValue(input)) {
    if (input.type === "env") return input;
    return { ...input, value: "********" } as T;
  }
  if (Array.isArray(input)) {
    return input.map(maskProtectedValues) as T;
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, maskProtectedValues(v)]),
    ) as T;
  }
  return input;
}

export function preserveMaskedProtectedValues<T>(incoming: T, existing: T): T {
  if (
    isProtectedValue(incoming) &&
    incoming.type === "protected" &&
    incoming.value === "********" &&
    isProtectedValue(existing)
  ) {
    return existing as T;
  }
  if (isProtectedValue(incoming) && incoming.type === "env") {
    return incoming;
  }
  if (Array.isArray(incoming) && Array.isArray(existing)) {
    return incoming.map((item, i) => preserveMaskedProtectedValues(item, existing[i])) as T;
  }
  if (
    incoming &&
    existing &&
    typeof incoming === "object" &&
    typeof existing === "object"
  ) {
    return Object.fromEntries(
      Object.entries(incoming as Record<string, unknown>).map(([k, v]) => [
        k,
        preserveMaskedProtectedValues(v, (existing as Record<string, unknown>)[k]),
      ]),
    ) as T;
  }
  return incoming;
}
