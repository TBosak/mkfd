// utilities/sensitive-config.utility.ts
import { isProtectedValue } from "./protected-values.utility";

const SENSITIVE_PATTERNS = [
  "authorization", "cookie", "x-api-key", "apikey", "apitoken",
  "token", "secret", "password", "passwd", "session", "csrf",
  "access_token", "refresh_token", "bearer",
];

export function isSensitiveConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

export type PlainSensitiveValueFinding = { path: string; message: string };

export function findPlainSensitiveValues(
  input: unknown,
  path = "",
): PlainSensitiveValueFinding[] {
  if (isProtectedValue(input)) return [];

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    if (path && isSensitiveConfigPath(path)) {
      return [{ path, message: "This value looks sensitive. Consider encrypting it." }];
    }
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item, i) => findPlainSensitiveValues(item, `${path}[${i}]`));
  }

  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).flatMap(([k, v]) =>
      findPlainSensitiveValues(v, path ? `${path}.${k}` : k),
    );
  }

  return [];
}
