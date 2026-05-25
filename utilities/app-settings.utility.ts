/**
 * App Settings Utility
 *
 * Provides a typed key registry for application settings with:
 * - Three classes: A (UI-manageable, no restart), B (UI-manageable, restart required),
 *   C (env-only, read-only via API)
 * - Precedence: db > env > default
 * - Masking for sensitive (class C) keys
 * - Validation and normalization for all keys
 */

import type { Database } from "bun:sqlite";
import { getAppSettings, saveAppSettings } from "../lib/analytics/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingClass = "A" | "B" | "C";
export type SettingType = "string" | "number" | "boolean" | "string[]";
export type SettingSource = "db" | "env" | "default";

export interface SettingMeta {
  key: string;
  type: SettingType;
  class: SettingClass;
  restartRequired: boolean;
  masked: boolean;
  envVar: string | null;
  defaultValue: SettingValue;
  validate?: (value: SettingValue) => string | null; // returns error message or null if valid
}

export type SettingValue = string | number | boolean | string[];

export interface EffectiveSetting {
  value: SettingValue;
  source: SettingSource;
  restartRequired: boolean;
  class: SettingClass;
  masked: boolean;
}

export type EffectiveSettings = Record<string, EffectiveSetting>;

// ---------------------------------------------------------------------------
// Key Registry
// ---------------------------------------------------------------------------

const MASK = "***";

export const SETTING_REGISTRY: Record<string, SettingMeta> = {
  // ── Class A: UI-manageable, no restart required ──────────────────────────
  retention_days: {
    key: "retention_days",
    type: "number",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "RETENTION_DAYS",
    defaultValue: 90,
    validate(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return "retention_days must be a positive integer";
      return null;
    },
  },
  retention_days_enabled: {
    key: "retention_days_enabled",
    type: "boolean",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "RETENTION_DAYS_ENABLED",
    // false by default: time-based pruning is opt-in; users must explicitly enable it.
    defaultValue: false,
  },
  retention_runs: {
    key: "retention_runs",
    type: "number",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "RETENTION_RUNS",
    defaultValue: 1000,
    validate(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return "retention_runs must be a positive integer";
      return null;
    },
  },
  retention_runs_enabled: {
    key: "retention_runs_enabled",
    type: "boolean",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "RETENTION_RUNS_ENABLED",
    defaultValue: true,
  },
  allow_private_fetches: {
    key: "allow_private_fetches",
    type: "boolean",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "ALLOW_PRIVATE_FETCHES",
    defaultValue: false,
  },
  outbound_fetch_allowlist: {
    key: "outbound_fetch_allowlist",
    type: "string[]",
    class: "A",
    restartRequired: false,
    masked: false,
    envVar: "OUTBOUND_FETCH_ALLOWLIST",
    defaultValue: [],
    validate(v) {
      if (!Array.isArray(v)) return "outbound_fetch_allowlist must be an array of strings";
      return null;
    },
  },

  // ── Class B: UI-manageable, restart required ──────────────────────────────
  feed_run_timeout_ms: {
    key: "feed_run_timeout_ms",
    type: "number",
    class: "B",
    restartRequired: true,
    masked: false,
    envVar: "FEED_RUN_TIMEOUT_MS",
    defaultValue: 120000,
    validate(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1000)
        return "feed_run_timeout_ms must be an integer >= 1000";
      return null;
    },
  },

  // ── Class C: env-only, never writable via API ─────────────────────────────
  encryption_key: {
    key: "encryption_key",
    type: "string",
    class: "C",
    restartRequired: true,
    masked: true,
    envVar: "ENCRYPTION_KEY",
    defaultValue: "",
  },
  passkey: {
    key: "passkey",
    type: "string",
    class: "C",
    restartRequired: true,
    masked: true,
    envVar: "PASSKEY",
    defaultValue: "",
  },
  cookie_secret: {
    key: "cookie_secret",
    type: "string",
    class: "C",
    restartRequired: true,
    masked: true,
    envVar: "COOKIE_SECRET",
    defaultValue: "",
  },
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parses a raw string from the database or environment into the appropriate
 * typed value for a setting.
 */
export function parseRawValue(meta: SettingMeta, raw: string): SettingValue {
  switch (meta.type) {
    case "number":
      return Number(raw);
    case "boolean":
      return raw === "true" || raw === "1";
    case "string[]":
      // comma-separated for env vars; JSON array for db storage
      if (raw.startsWith("[")) {
        try {
          return JSON.parse(raw) as string[];
        } catch {
          // fall through to comma-split
        }
      }
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default:
      return raw;
  }
}

/**
 * Serializes a typed value to a string for storage in the database.
 */
export function serializeValue(meta: SettingMeta, value: SettingValue): string {
  if (meta.type === "string[]") {
    return JSON.stringify(value);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  key: string;
  message: string;
}

/**
 * Validates a single setting value against its registry definition.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateSetting(key: string, value: SettingValue): string | null {
  const meta = SETTING_REGISTRY[key];
  if (!meta) return `Unknown setting key: ${key}`;

  // Type check
  switch (meta.type) {
    case "number":
      if (typeof value !== "number" || isNaN(value as number))
        return `${key} must be a number`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `${key} must be a boolean`;
      break;
    case "string[]":
      if (!Array.isArray(value) || (value as unknown[]).some((x) => typeof x !== "string"))
        return `${key} must be an array of strings`;
      break;
    case "string":
      if (typeof value !== "string") return `${key} must be a string`;
      break;
  }

  // Custom validator
  if (meta.validate) {
    return meta.validate(value);
  }

  return null;
}

/**
 * Validates a partial settings update object. Returns an array of per-field
 * validation errors (empty array = all valid).
 */
export function validateSettingsUpdate(
  input: Record<string, SettingValue>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [key, value] of Object.entries(input)) {
    const meta = SETTING_REGISTRY[key];
    if (!meta) {
      errors.push({ key, message: `Unknown setting key: ${key}` });
      continue;
    }
    if (meta.class === "C") {
      errors.push({
        key,
        message: `Key '${key}' is env-managed and read-only`,
      });
      continue;
    }
    const err = validateSetting(key, value);
    if (err) errors.push({ key, message: err });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Effective settings resolver (db > env > default)
// ---------------------------------------------------------------------------

/**
 * Reads env var for a setting and returns the parsed value, or null if the
 * env var is not set.
 */
function readEnvValue(meta: SettingMeta): SettingValue | null {
  if (!meta.envVar) return null;
  const raw = process.env[meta.envVar];
  if (raw === undefined || raw === "") return null;
  return parseRawValue(meta, raw);
}

/**
 * Resolves the effective value, source, and metadata for a single setting
 * given its raw DB value (or undefined if not in the DB).
 */
export function resolveEffectiveSetting(
  meta: SettingMeta,
  dbRaw: string | undefined,
): EffectiveSetting {
  let value: SettingValue;
  let source: SettingSource;

  if (dbRaw !== undefined && meta.class !== "C") {
    value = parseRawValue(meta, dbRaw);
    source = "db";
  } else {
    const envValue = readEnvValue(meta);
    if (envValue !== null) {
      value = envValue;
      source = "env";
    } else {
      value = meta.defaultValue;
      source = "default";
    }
  }

  const maskedValue = meta.masked ? MASK : value;

  return {
    value: maskedValue,
    source,
    restartRequired: meta.restartRequired,
    class: meta.class,
    masked: meta.masked,
  };
}

/**
 * Resolves effective settings for all registered keys using the provided DB
 * snapshot. This is the main entry point for building the GET /api/settings
 * response.
 *
 * Precedence per key: db > env > default
 * - Class C keys always come from env (never DB); their values are masked.
 */
export function resolveAllEffectiveSettings(
  dbSnapshot: Record<string, string>,
): EffectiveSettings {
  const result: EffectiveSettings = {};
  for (const meta of Object.values(SETTING_REGISTRY)) {
    result[meta.key] = resolveEffectiveSetting(meta, dbSnapshot[meta.key]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API helpers (used by route handlers)
// ---------------------------------------------------------------------------

/**
 * Returns the full effective settings map, reading current DB state.
 */
export async function getEffectiveSettings(
  sqlite: Database,
): Promise<EffectiveSettings> {
  const dbSnapshot = await getAppSettings(sqlite);
  return resolveAllEffectiveSettings(dbSnapshot);
}

/**
 * Applies a validated partial update to the DB, then returns the new effective
 * settings. Assumes the caller has already run validateSettingsUpdate() and
 * confirmed there are no errors.
 */
export async function applySettingsUpdate(
  sqlite: Database,
  input: Record<string, SettingValue>,
): Promise<EffectiveSettings> {
  const toStore: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const meta = SETTING_REGISTRY[key];
    if (!meta) continue; // unreachable after validation, but guard anyway
    toStore[key] = serializeValue(meta, value);
  }
  await saveAppSettings(sqlite, toStore);
  return getEffectiveSettings(sqlite);
}
