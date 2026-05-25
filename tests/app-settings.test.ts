import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../lib/analytics/schema";
import { getAppSettings, saveAppSettings } from "../lib/analytics/db";
import {
  parseRawValue,
  serializeValue,
  validateSetting,
  validateSettingsUpdate,
  resolveEffectiveSetting,
  resolveAllEffectiveSettings,
  applySettingsUpdate,
  getEffectiveSettings,
  SETTING_REGISTRY,
} from "../utilities/app-settings.utility";

// ---------------------------------------------------------------------------
// Test DB factory
// ---------------------------------------------------------------------------

function makeTestDb(): Database {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle/migrations" });
  return sqlite;
}

// ---------------------------------------------------------------------------
// Helper: temporarily set/restore env vars
// ---------------------------------------------------------------------------

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// parseRawValue
// ---------------------------------------------------------------------------

describe("parseRawValue", () => {
  const numberMeta = SETTING_REGISTRY.retention_days;
  const boolMeta = SETTING_REGISTRY.retention_days_enabled;
  const listMeta = SETTING_REGISTRY.outbound_fetch_allowlist;
  const strMeta = SETTING_REGISTRY.encryption_key;

  it("parses number strings", () => {
    expect(parseRawValue(numberMeta, "90")).toBe(90);
    expect(parseRawValue(numberMeta, "7")).toBe(7);
  });

  it("parses boolean 'true'/'false'", () => {
    expect(parseRawValue(boolMeta, "true")).toBe(true);
    expect(parseRawValue(boolMeta, "false")).toBe(false);
  });

  it("parses boolean '1' as true, other as false", () => {
    expect(parseRawValue(boolMeta, "1")).toBe(true);
    expect(parseRawValue(boolMeta, "0")).toBe(false);
  });

  it("parses comma-separated string[] from env-style value", () => {
    const result = parseRawValue(listMeta, "host1.local,host2.local");
    expect(result).toEqual(["host1.local", "host2.local"]);
  });

  it("parses JSON-serialized string[] from DB-style value", () => {
    const result = parseRawValue(listMeta, '["host1.local","host2.local"]');
    expect(result).toEqual(["host1.local", "host2.local"]);
  });

  it("parses empty string as empty array for string[]", () => {
    const result = parseRawValue(listMeta, "");
    expect(result).toEqual([]);
  });

  it("returns the raw string for string type", () => {
    expect(parseRawValue(strMeta, "secret-value")).toBe("secret-value");
  });
});

// ---------------------------------------------------------------------------
// serializeValue
// ---------------------------------------------------------------------------

describe("serializeValue", () => {
  it("serializes number to string", () => {
    expect(serializeValue(SETTING_REGISTRY.retention_days, 90)).toBe("90");
  });

  it("serializes boolean to string", () => {
    expect(serializeValue(SETTING_REGISTRY.retention_days_enabled, true)).toBe("true");
    expect(serializeValue(SETTING_REGISTRY.retention_days_enabled, false)).toBe("false");
  });

  it("serializes string[] as JSON", () => {
    expect(serializeValue(SETTING_REGISTRY.outbound_fetch_allowlist, ["a", "b"])).toBe('["a","b"]');
  });

  it("serializes empty array as JSON", () => {
    expect(serializeValue(SETTING_REGISTRY.outbound_fetch_allowlist, [])).toBe("[]");
  });
});

// ---------------------------------------------------------------------------
// validateSetting
// ---------------------------------------------------------------------------

describe("validateSetting", () => {
  it("accepts valid retention_days", () => {
    expect(validateSetting("retention_days", 30)).toBeNull();
    expect(validateSetting("retention_days", 1)).toBeNull();
  });

  it("rejects non-positive retention_days", () => {
    expect(validateSetting("retention_days", 0)).not.toBeNull();
    expect(validateSetting("retention_days", -5)).not.toBeNull();
  });

  it("rejects non-integer retention_days", () => {
    expect(validateSetting("retention_days", 1.5)).not.toBeNull();
  });

  it("accepts valid retention_runs", () => {
    expect(validateSetting("retention_runs", 100)).toBeNull();
  });

  it("rejects invalid retention_runs", () => {
    expect(validateSetting("retention_runs", 0)).not.toBeNull();
  });

  it("accepts valid feed_run_timeout_ms", () => {
    expect(validateSetting("feed_run_timeout_ms", 60000)).toBeNull();
    expect(validateSetting("feed_run_timeout_ms", 1000)).toBeNull();
  });

  it("rejects feed_run_timeout_ms < 1000", () => {
    expect(validateSetting("feed_run_timeout_ms", 999)).not.toBeNull();
    expect(validateSetting("feed_run_timeout_ms", 0)).not.toBeNull();
  });

  it("accepts valid boolean", () => {
    expect(validateSetting("allow_private_fetches", true)).toBeNull();
    expect(validateSetting("allow_private_fetches", false)).toBeNull();
  });

  it("rejects wrong type for boolean", () => {
    expect(validateSetting("allow_private_fetches", "true" as unknown as boolean)).not.toBeNull();
  });

  it("accepts valid string[]", () => {
    expect(validateSetting("outbound_fetch_allowlist", ["host1.local"])).toBeNull();
    expect(validateSetting("outbound_fetch_allowlist", [])).toBeNull();
  });

  it("returns error for unknown key", () => {
    expect(validateSetting("nonexistent_key", "value")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateSettingsUpdate
// ---------------------------------------------------------------------------

describe("validateSettingsUpdate", () => {
  it("returns empty array for valid class A update", () => {
    const errors = validateSettingsUpdate({ retention_days: 60, retention_days_enabled: true });
    expect(errors).toEqual([]);
  });

  it("rejects class C keys with read-only error", () => {
    const errors = validateSettingsUpdate({ encryption_key: "new-key" });
    expect(errors.length).toBe(1);
    expect(errors[0].key).toBe("encryption_key");
    expect(errors[0].message).toContain("env-managed and read-only");
  });

  it("rejects class C keys — passkey", () => {
    const errors = validateSettingsUpdate({ passkey: "mypassword" });
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("env-managed and read-only");
  });

  it("rejects unknown keys", () => {
    const errors = validateSettingsUpdate({ totally_unknown: "x" } as Record<string, any>);
    expect(errors.length).toBe(1);
    expect(errors[0].key).toBe("totally_unknown");
  });

  it("returns multiple errors for multiple invalid keys", () => {
    const errors = validateSettingsUpdate({
      encryption_key: "secret",
      retention_days: -1,
    });
    expect(errors.length).toBe(2);
  });

  it("accepts class B keys", () => {
    const errors = validateSettingsUpdate({ feed_run_timeout_ms: 60000 });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveSetting — precedence chain
// ---------------------------------------------------------------------------

describe("resolveEffectiveSetting — precedence", () => {
  it("uses db value when present (class A)", () => {
    withEnv({ RETENTION_DAYS: "45" }, () => {
      const meta = SETTING_REGISTRY.retention_days;
      const result = resolveEffectiveSetting(meta, "60");
      expect(result.value).toBe(60);
      expect(result.source).toBe("db");
    });
  });

  it("falls back to env when no db value (class A)", () => {
    withEnv({ RETENTION_DAYS: "45" }, () => {
      const meta = SETTING_REGISTRY.retention_days;
      const result = resolveEffectiveSetting(meta, undefined);
      expect(result.value).toBe(45);
      expect(result.source).toBe("env");
    });
  });

  it("falls back to default when neither db nor env is set (class A)", () => {
    withEnv({ RETENTION_DAYS: undefined }, () => {
      const meta = SETTING_REGISTRY.retention_days;
      const result = resolveEffectiveSetting(meta, undefined);
      expect(result.value).toBe(90); // default
      expect(result.source).toBe("default");
    });
  });

  it("class C keys always come from env, never db", () => {
    withEnv({ ENCRYPTION_KEY: "my-secret" }, () => {
      const meta = SETTING_REGISTRY.encryption_key;
      // Even if a dbRaw is provided for class C, it should be ignored
      const result = resolveEffectiveSetting(meta, "ignored-db-value");
      expect(result.source).toBe("env");
    });
  });

  it("class C keys with no env set use default and source=default", () => {
    withEnv({ ENCRYPTION_KEY: undefined }, () => {
      const meta = SETTING_REGISTRY.encryption_key;
      const result = resolveEffectiveSetting(meta, undefined);
      expect(result.source).toBe("default");
    });
  });
});

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

describe("masking", () => {
  it("masks class C values in resolveEffectiveSetting", () => {
    withEnv({ ENCRYPTION_KEY: "super-secret" }, () => {
      const meta = SETTING_REGISTRY.encryption_key;
      const result = resolveEffectiveSetting(meta, undefined);
      expect(result.value).toBe("***");
      expect(result.masked).toBe(true);
    });
  });

  it("does not mask class A values", () => {
    const meta = SETTING_REGISTRY.retention_days;
    const result = resolveEffectiveSetting(meta, "90");
    expect(result.value).toBe(90);
    expect(result.masked).toBe(false);
  });

  it("masks all class C keys in resolveAllEffectiveSettings", () => {
    withEnv({ ENCRYPTION_KEY: "secret", PASSKEY: "pass", COOKIE_SECRET: "cookie" }, () => {
      const effective = resolveAllEffectiveSettings({});
      expect(effective.encryption_key.value).toBe("***");
      expect(effective.passkey.value).toBe("***");
      expect(effective.cookie_secret.value).toBe("***");
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAllEffectiveSettings
// ---------------------------------------------------------------------------

describe("resolveAllEffectiveSettings", () => {
  it("returns an entry for every registered key", () => {
    withEnv({ RETENTION_DAYS: undefined, ENCRYPTION_KEY: undefined, PASSKEY: undefined, COOKIE_SECRET: undefined }, () => {
      const effective = resolveAllEffectiveSettings({});
      const registryKeys = Object.keys(SETTING_REGISTRY);
      for (const key of registryKeys) {
        expect(effective[key]).toBeDefined();
      }
    });
  });

  it("uses db values when present", () => {
    withEnv({ RETENTION_DAYS: "200" }, () => {
      const effective = resolveAllEffectiveSettings({ retention_days: "60" });
      expect(effective.retention_days.value).toBe(60);
      expect(effective.retention_days.source).toBe("db");
    });
  });
});

// ---------------------------------------------------------------------------
// DB integration: getEffectiveSettings / applySettingsUpdate
// ---------------------------------------------------------------------------

describe("getEffectiveSettings / applySettingsUpdate (DB)", () => {
  it("returns defaults when DB is empty", async () => {
    const sqlite = makeTestDb();
    await withEnv({ RETENTION_DAYS: undefined, RETENTION_RUNS: undefined }, async () => {
      const effective = await getEffectiveSettings(sqlite);
      expect(effective.retention_days.value).toBe(90);
      expect(effective.retention_days.source).toBe("default");
      expect(effective.retention_runs.value).toBe(1000);
    });
  });

  it("persists and retrieves a partial update", async () => {
    const sqlite = makeTestDb();
    await applySettingsUpdate(sqlite, { retention_days: 30 });
    const effective = await getEffectiveSettings(sqlite);
    expect(effective.retention_days.value).toBe(30);
    expect(effective.retention_days.source).toBe("db");
  });

  it("applySettingsUpdate is idempotent (upsert)", async () => {
    const sqlite = makeTestDb();
    await applySettingsUpdate(sqlite, { retention_days: 30 });
    await applySettingsUpdate(sqlite, { retention_days: 14 });
    const effective = await getEffectiveSettings(sqlite);
    expect(effective.retention_days.value).toBe(14);
  });

  it("stores boolean settings correctly", async () => {
    const sqlite = makeTestDb();
    await applySettingsUpdate(sqlite, { retention_days_enabled: false });
    const effective = await getEffectiveSettings(sqlite);
    expect(effective.retention_days_enabled.value).toBe(false);
    expect(effective.retention_days_enabled.source).toBe("db");
  });

  it("stores string[] settings correctly", async () => {
    const sqlite = makeTestDb();
    await applySettingsUpdate(sqlite, { outbound_fetch_allowlist: ["host1.local", "host2.local"] });
    const effective = await getEffectiveSettings(sqlite);
    expect(effective.outbound_fetch_allowlist.value).toEqual(["host1.local", "host2.local"]);
    expect(effective.outbound_fetch_allowlist.source).toBe("db");
  });
});

// ---------------------------------------------------------------------------
// Key registry shape
// ---------------------------------------------------------------------------

describe("SETTING_REGISTRY shape", () => {
  it("all registered keys have required fields", () => {
    for (const [key, meta] of Object.entries(SETTING_REGISTRY)) {
      expect(meta.key).toBe(key);
      expect(["A", "B", "C"]).toContain(meta.class);
      expect(["string", "number", "boolean", "string[]"]).toContain(meta.type);
      expect(typeof meta.restartRequired).toBe("boolean");
      expect(typeof meta.masked).toBe("boolean");
    }
  });

  it("class C keys are all masked", () => {
    for (const meta of Object.values(SETTING_REGISTRY)) {
      if (meta.class === "C") {
        expect(meta.masked).toBe(true);
      }
    }
  });

  it("class A/B keys are not masked", () => {
    for (const meta of Object.values(SETTING_REGISTRY)) {
      if (meta.class !== "C") {
        expect(meta.masked).toBe(false);
      }
    }
  });

  it("class A keys have restartRequired=false", () => {
    for (const meta of Object.values(SETTING_REGISTRY)) {
      if (meta.class === "A") {
        expect(meta.restartRequired).toBe(false);
      }
    }
  });

  it("class B keys have restartRequired=true", () => {
    for (const meta of Object.values(SETTING_REGISTRY)) {
      if (meta.class === "B") {
        expect(meta.restartRequired).toBe(true);
      }
    }
  });
});
