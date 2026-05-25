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
