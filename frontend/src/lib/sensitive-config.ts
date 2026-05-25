const SENSITIVE_PATTERNS = [
  "authorization", "cookie", "x-api-key", "apikey", "apitoken",
  "token", "secret", "password", "passwd", "session", "csrf",
  "access_token", "refresh_token", "bearer",
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => key.toLowerCase().includes(p));
}
