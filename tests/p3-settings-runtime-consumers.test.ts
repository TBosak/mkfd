// Test suite for slice p3-settings-runtime-consumers.
//
// Requirements exercised (see docs/tdd/p3-settings-runtime-consumers.md):
//   1. Saving `allow_private_fetches` through the real settings write path
//      changes the outbound policy's *decision* on the very next call, in
//      the same process, with no restart.
//   2. A host added to `outbound_fetch_allowlist` through the settings path
//      is accepted by the outbound policy afterwards; removing it is
//      refused again.
//   3. `feed_run_timeout_ms` reaches `resolveFetchPolicy` and constrains the
//      real retry budget `executeWithFetchPolicy` applies — not just the
//      number the resolver returns.
//   4. Precedence (stored beats env beats registry default) is proven at
//      each level, for every setting this slice wires up.
//   5. Class C settings (`passkey`, `cookie_secret`, `encryption_key`)
//      continue to be rejected on write, never persisted, and never
//      returned unmasked — proven at the real route boundary
//      (routes/settings.ts) so the plumbing change around them cannot
//      regress this.
//   6. A genuinely unreadable database (not mocked — a real corrupt SQLite
//      file, the same technique tests/p3-settings-substrate-reconciliation
//      .test.ts uses) makes the outbound policy fail closed: private
//      fetches disallowed, allowlist empty — even when the environment
//      asks for the permissive posture. It must not throw either, since
//      most call sites of `getGlobalFetchPolicyOptions()` do not wrap it in
//      try/catch.
//   7. This file never touches the nine locked p3-shared-outbound-executor
//      test files or their production decision logic (isBlockedAddress,
//      metadata-hostname blocking, redirect revalidation). It only drives
//      `getGlobalFetchPolicyOptions()` / `resolveFetchPolicy()` — the two
//      functions this slice is scoped to — through the real settings write
//      path and asserts on the resulting policy *decisions*.
//
// Design decisions made by this test (flagged for lead review, since the
// brief explicitly left them open):
//
//   - `getGlobalFetchPolicyOptions()` is assumed to keep its exact current
//     signature: synchronous, zero required parameters, returning
//     `OutboundFetchPolicyOptions` (not a Promise). This is not just a
//     style preference — it is close to a hard constraint. The *locked*
//     tests/feed-updater-worker-outbound-executor.test.ts already calls it
//     synchronously with no DB row present and expects env-fallback to
//     still work (see its "env-based: ... the worker's own global,
//     env-driven allowlist" comment), and several production call sites
//     use it as a synchronous default parameter value (e.g.
//     `utilities/json-ld-drill-chain.utility.ts`'s
//     `policyOptions: OutboundFetchPolicyOptions = getGlobalFetchPolicyOptions()`),
//     which cannot be awaited. These tests therefore never `await`
//     `getGlobalFetchPolicyOptions()` and always call it with no arguments,
//     assuming it reaches the live settings store through the existing
//     `getDb()` singleton (`lib/analytics/db.ts`) rather than a passed-in
//     handle — that is the only way a zero-argument function can reach the
//     database at all. Whether the implementation caches or re-reads on
//     every call is left open (both are exercised: requirement 1 drives a
//     write→read round trip in the same process and expects the *next*
//     call to reflect it; requirement 6 drives a read failure and expects
//     it to be caught, not cached-around).
//   - `resolveFetchPolicy()` also keeps its current synchronous signature.
//   - `feed_run_timeout_ms` is registered as class B (`restartRequired:
//     true`), but requirement 3's wording ("changing it changes the
//     deadline the executor applies") carries no restart caveat, unlike
//     requirement 1's explicit "without a restart" for class A — and the
//     brief's own open question leans this way ("read per-run, so live
//     seems right"). These tests therefore assume `resolveFetchPolicy`
//     consults the *effective* setting (db > env > default) fresh on every
//     call, exactly mirroring class A precedence, and that the registry's
//     `restartRequired: true` flag governs only the Settings UI's
//     "restart required" messaging (Packet 4), not enforcement here. A
//     restart-durability test is still included (requirement 4) to prove
//     the stored value survives a fresh `initDb()` against the same file,
//     which holds under either interpretation.
//   - Today `utilities/fetch-policy.utility.ts` has its own hardcoded
//     `DEFAULT_POLICY.feedRunTimeoutMs` (60000) that is independent of
//     `SETTING_REGISTRY.feed_run_timeout_ms.defaultValue` (120000) — two
//     unreconciled sources of "the default". These tests assume the fix
//     makes the registry's default the one true fallback (requirement 4's
//     "default" tier), since the whole point of this slice is that the
//     registry becomes authoritative end to end. If the lead intends to
//     keep a fetch-policy-local default distinct from the registry's, that
//     is a real design disagreement to flag back, not a test bug.
//   - No fourth unwired registry setting was found. `retention_days`,
//     `retention_days_enabled`, `retention_runs`, and
//     `retention_runs_enabled` are already wired end to end through
//     `utilities/worker-manager.utility.ts` (per the brief's "What is
//     already correct" section); `encryption_key`, `passkey`, and
//     `cookie_secret` are class C and correctly never DB-backed by design.
//     That leaves exactly the three the brief names:
//     `allow_private_fetches`, `outbound_fetch_allowlist`, and
//     `feed_run_timeout_ms`.
//   - Requirement 6 is proven against a real corrupt SQLite file (garbage
//     bytes at the DB path), not a mock — `new Database()` opens such a
//     file lazily and only fails on the first query, which is exactly what
//     `initDb()`'s existing degraded-database handling
//     (`lib/analytics/db.ts`) already relies on and what
//     tests/p3-settings-substrate-reconciliation.test.ts already
//     establishes as this repo's pattern for "genuinely unreadable".

import { afterEach, describe, expect, test } from "bun:test";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDatabaseReadiness, getDb, initDb } from "../lib/analytics/db";
import { applySettingsUpdate } from "../utilities/app-settings.utility";
import {
  assertAndResolveOutboundTarget,
  getGlobalFetchPolicyOptions,
} from "../utilities/outbound-fetch-policy.utility";
import { executeWithFetchPolicy, resolveFetchPolicy } from "../utilities/fetch-policy.utility";
import { settingsRouter } from "../routes/settings";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

let tmpCounter = 0;
/** A fresh, collision-free relative directory under .tdd-state for this slice's fixtures. */
function uniqueDir(label: string): string {
  tmpCounter += 1;
  return join(".tdd-state", "_p3-settings-runtime-consumers", `${label}-${Date.now()}-${tmpCounter}`);
}

/** Mirrors initDb()'s own `join(process.cwd(), dbPath)` so tests can reach the same file. */
function absDbPath(relDbPath: string): string {
  return join(process.cwd(), relDbPath);
}

const ENV_KEYS = ["ALLOW_PRIVATE_FETCHES", "OUTBOUND_FETCH_ALLOWLIST", "FEED_RUN_TIMEOUT_MS", "PASSKEY"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Requirement 1: allow_private_fetches changes enforcement live, same
// process, no restart.
// ---------------------------------------------------------------------------

describe("requirement 1: allow_private_fetches changes outbound enforcement live, in the same process, without a restart", () => {
  test("toggling the setting through the real write path flips the policy's decision on the very next call, in both directions", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: undefined }, async () => {
      const relDb = join(uniqueDir("req1-toggle"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { allow_private_fetches: false });

      const privateUrl = "http://10.4.5.6/internal";

      await expect(
        assertAndResolveOutboundTarget(privateUrl, getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/private|reserved/i);

      await applySettingsUpdate(getDb(), { allow_private_fetches: true });

      await expect(
        assertAndResolveOutboundTarget(privateUrl, getGlobalFetchPolicyOptions()),
      ).resolves.toEqual({ address: "10.4.5.6" });

      await applySettingsUpdate(getDb(), { allow_private_fetches: false });

      await expect(
        assertAndResolveOutboundTarget(privateUrl, getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/private|reserved/i);
    });
  });

  test("known cloud metadata hosts stay blocked even after allow_private_fetches is turned on (decision logic itself is untouched)", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: undefined }, async () => {
      const relDb = join(uniqueDir("req1-metadata"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { allow_private_fetches: true });

      await expect(
        assertAndResolveOutboundTarget("http://169.254.169.254/latest/meta-data/", getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/metadata/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 2: outbound_fetch_allowlist reaches the policy.
// ---------------------------------------------------------------------------

describe("requirement 2: outbound_fetch_allowlist reaches the policy", () => {
  test("a host added through the settings write path is accepted; removing it is refused again", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: undefined, OUTBOUND_FETCH_ALLOWLIST: undefined }, async () => {
      const relDb = join(uniqueDir("req2-allowlist"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { allow_private_fetches: false, outbound_fetch_allowlist: [] });

      const target = "http://10.7.7.7/internal";

      await expect(
        assertAndResolveOutboundTarget(target, getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/private|reserved/i);

      await applySettingsUpdate(getDb(), { outbound_fetch_allowlist: ["10.7.7.7"] });

      await expect(
        assertAndResolveOutboundTarget(target, getGlobalFetchPolicyOptions()),
      ).resolves.toEqual({ address: "10.7.7.7" });

      await applySettingsUpdate(getDb(), { outbound_fetch_allowlist: [] });

      await expect(
        assertAndResolveOutboundTarget(target, getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/private|reserved/i);
    });
  });

  test("an unrelated host is still refused while another host is allowlisted (the allowlist is not treated as a blanket override)", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: undefined, OUTBOUND_FETCH_ALLOWLIST: undefined }, async () => {
      const relDb = join(uniqueDir("req2-scoped"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), {
        allow_private_fetches: false,
        outbound_fetch_allowlist: ["10.7.7.7"],
      });

      await expect(
        assertAndResolveOutboundTarget("http://10.7.7.8/internal", getGlobalFetchPolicyOptions()),
      ).rejects.toThrow(/private|reserved/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 3: feed_run_timeout_ms reaches the fetch policy and
// constrains the real executor, not just the resolved number.
// ---------------------------------------------------------------------------

describe("requirement 3: feed_run_timeout_ms reaches the fetch policy", () => {
  test("resolveFetchPolicy consults the stored setting when no feed-level override is given", async () => {
    await withEnv({ FEED_RUN_TIMEOUT_MS: undefined }, async () => {
      const relDb = join(uniqueDir("req3-resolve"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { feed_run_timeout_ms: 5000 });

      const policy = resolveFetchPolicy({});
      expect(policy.feedRunTimeoutMs).toBe(5000);
    });
  });

  test("a feed-level override still wins over the stored setting", async () => {
    await withEnv({ FEED_RUN_TIMEOUT_MS: undefined }, async () => {
      const relDb = join(uniqueDir("req3-override"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { feed_run_timeout_ms: 5000 });

      const policy = resolveFetchPolicy({ fetchPolicy: { feedRunTimeoutMs: 8000 } });
      expect(policy.feedRunTimeoutMs).toBe(8000);
    });
  });

  test(
    "changing the stored setting changes the real retry budget executeWithFetchPolicy applies — asserted via attempt count, not the resolved number",
    async () => {
      await withEnv({ FEED_RUN_TIMEOUT_MS: undefined }, async () => {
        const relDb = join(uniqueDir("req3-executor"), "runtime.db");
        initDb(relDb);

        // A fixed backoff between the initial attempt and its one retry.
        // Deliberately real wall-clock time (not mocked), so the "generous"
        // case below genuinely waits out the backoff — that is the only way
        // to prove the *executor's* deadline check, not just the number
        // resolveFetchPolicy returns, responds to the stored setting.
        const BACKOFF_MS = 1200;

        async function attemptCountFor(timeoutMs: number): Promise<number> {
          await applySettingsUpdate(getDb(), { feed_run_timeout_ms: timeoutMs });
          const policy = resolveFetchPolicy({
            fetchPolicy: { retryCount: 1, retryBackoffMode: "fixed", retryBackoffMs: BACKOFF_MS },
          });
          try {
            await executeWithFetchPolicy({
              url: "http://example.invalid/feed",
              policy,
              axiosGet: async (): Promise<AxiosResponse> => ({
                status: 500,
                statusText: "Internal Server Error",
                data: "",
                headers: new AxiosHeaders(),
                config: { headers: new AxiosHeaders() },
              }),
            });
            throw new Error("expected executeWithFetchPolicy to fail for a persistently-500 stub");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const match = /Fetch failed after (\d+) attempt/.exec(message);
            if (!match) throw err;
            return Number(match[1]);
          }
        }

        // A generous stored timeout leaves room for the fixed backoff
        // between the initial attempt and its one retry: both attempts run.
        const generous = await attemptCountFor(10000);
        // The minimum allowed stored timeout leaves no room for that same
        // backoff: the retry loop's own deadline check must skip it.
        const tiny = await attemptCountFor(1000);

        expect(generous).toBe(2);
        expect(tiny).toBe(1);
      });
    },
    15_000,
  );

  test("the stored value survives a fresh initDb() against the same file (restart-durability, independent of the live-vs-restart-gated question)", async () => {
    await withEnv({ FEED_RUN_TIMEOUT_MS: undefined }, async () => {
      const relDb = join(uniqueDir("req3-restart"), "runtime.db");
      initDb(relDb);
      await applySettingsUpdate(getDb(), { feed_run_timeout_ms: 42000 });

      // Simulate a process restart against the same on-disk file: a fresh
      // initDb() call re-opens it rather than reusing any in-memory state.
      initDb(relDb);

      const policy = resolveFetchPolicy({});
      expect(policy.feedRunTimeoutMs).toBe(42000);
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 4: precedence — stored beats env beats registry default,
// proven through the real consumers, not resolveEffectiveSetting directly
// (tests/app-settings.test.ts already covers the resolver in isolation).
// ---------------------------------------------------------------------------

describe("requirement 4: precedence through the real consumers", () => {
  describe("allow_private_fetches (class A)", () => {
    test("default: blocked when neither a stored value nor an env var is set", async () => {
      await withEnv({ ALLOW_PRIVATE_FETCHES: undefined }, async () => {
        const relDb = join(uniqueDir("req4-apf-default"), "runtime.db");
        initDb(relDb);

        await expect(
          assertAndResolveOutboundTarget("http://10.4.5.9/x", getGlobalFetchPolicyOptions()),
        ).rejects.toThrow(/private|reserved/i);
      });
    });

    test("env beats default: an env var allows when there is no stored value", async () => {
      await withEnv({ ALLOW_PRIVATE_FETCHES: "true" }, async () => {
        const relDb = join(uniqueDir("req4-apf-env"), "runtime.db");
        initDb(relDb);

        await expect(
          assertAndResolveOutboundTarget("http://10.4.5.10/x", getGlobalFetchPolicyOptions()),
        ).resolves.toEqual({ address: "10.4.5.10" });
      });
    });

    test("stored beats env: a stored 'false' overrides an env var asking for 'true'", async () => {
      await withEnv({ ALLOW_PRIVATE_FETCHES: "true" }, async () => {
        const relDb = join(uniqueDir("req4-apf-stored"), "runtime.db");
        initDb(relDb);
        await applySettingsUpdate(getDb(), { allow_private_fetches: false });

        await expect(
          assertAndResolveOutboundTarget("http://10.4.5.11/x", getGlobalFetchPolicyOptions()),
        ).rejects.toThrow(/private|reserved/i);
      });
    });
  });

  describe("outbound_fetch_allowlist (class A)", () => {
    test("default: empty allowlist when neither a stored value nor an env var is set", async () => {
      await withEnv({ OUTBOUND_FETCH_ALLOWLIST: undefined, ALLOW_PRIVATE_FETCHES: undefined }, async () => {
        const relDb = join(uniqueDir("req4-allow-default"), "runtime.db");
        initDb(relDb);

        await expect(
          assertAndResolveOutboundTarget("http://10.4.6.1/x", getGlobalFetchPolicyOptions()),
        ).rejects.toThrow(/private|reserved/i);
      });
    });

    test("env beats default: an env-supplied allowlist entry is honored when there is no stored value", async () => {
      await withEnv({ OUTBOUND_FETCH_ALLOWLIST: "10.4.6.2", ALLOW_PRIVATE_FETCHES: undefined }, async () => {
        const relDb = join(uniqueDir("req4-allow-env"), "runtime.db");
        initDb(relDb);

        await expect(
          assertAndResolveOutboundTarget("http://10.4.6.2/x", getGlobalFetchPolicyOptions()),
        ).resolves.toEqual({ address: "10.4.6.2" });
      });
    });

    test("stored beats env: a stored empty allowlist overrides an env var naming the target host", async () => {
      await withEnv({ OUTBOUND_FETCH_ALLOWLIST: "10.4.6.3", ALLOW_PRIVATE_FETCHES: undefined }, async () => {
        const relDb = join(uniqueDir("req4-allow-stored"), "runtime.db");
        initDb(relDb);
        await applySettingsUpdate(getDb(), { outbound_fetch_allowlist: [] });

        await expect(
          assertAndResolveOutboundTarget("http://10.4.6.3/x", getGlobalFetchPolicyOptions()),
        ).rejects.toThrow(/private|reserved/i);
      });
    });
  });

  describe("feed_run_timeout_ms (class B — this slice assumes live per-call resolution; see header comment)", () => {
    test("default: the registry default (120000ms) applies when neither a stored value nor an env var is set", async () => {
      await withEnv({ FEED_RUN_TIMEOUT_MS: undefined }, async () => {
        const relDb = join(uniqueDir("req4-timeout-default"), "runtime.db");
        initDb(relDb);

        expect(resolveFetchPolicy({}).feedRunTimeoutMs).toBe(120000);
      });
    });

    test("env beats default: an env var supplies the value when there is no stored value", async () => {
      await withEnv({ FEED_RUN_TIMEOUT_MS: "45000" }, async () => {
        const relDb = join(uniqueDir("req4-timeout-env"), "runtime.db");
        initDb(relDb);

        expect(resolveFetchPolicy({}).feedRunTimeoutMs).toBe(45000);
      });
    });

    test("stored beats env: a stored value overrides an env var", async () => {
      await withEnv({ FEED_RUN_TIMEOUT_MS: "45000" }, async () => {
        const relDb = join(uniqueDir("req4-timeout-stored"), "runtime.db");
        initDb(relDb);
        await applySettingsUpdate(getDb(), { feed_run_timeout_ms: 30000 });

        expect(resolveFetchPolicy({}).feedRunTimeoutMs).toBe(30000);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 5: class C settings never become DB-backed. Driven at the
// real route boundary (routes/settings.ts) so a regression in the plumbing
// around them would be caught here, not only in the unit-level coverage
// tests/app-settings.test.ts already has for validateSettingsUpdate.
// ---------------------------------------------------------------------------

describe("requirement 5: class C settings stay env-only through the route boundary", () => {
  test.each([
    ["encryption_key", "attacker-supplied-encryption-key"],
    ["passkey", "attacker-supplied-passkey"],
    ["cookie_secret", "attacker-supplied-cookie-secret"],
  ])("PUT rejects %s and never persists a row for it", async (key, attackerValue) => {
    const relDb = join(uniqueDir(`req5-reject-${key}`), "runtime.db");
    initDb(relDb);

    const res = await settingsRouter.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: attackerValue }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { key: string; message: string }[] };
    expect(body.details.some((d) => d.key === key && /env-managed and read-only/i.test(d.message))).toBe(true);

    const rows = getDb()
      .query("SELECT key FROM app_settings WHERE key = ?")
      .all(key) as { key: string }[];
    expect(rows).toEqual([]);
  });

  test("a class C key bundled with a valid class A key rejects the whole request atomically — the valid key is not silently applied", async () => {
    const relDb = join(uniqueDir("req5-atomic"), "runtime.db");
    initDb(relDb);

    const res = await settingsRouter.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encryption_key: "attacker-supplied-key", retention_days: 45 }),
    });

    expect(res.status).toBe(400);
    const rows = getDb()
      .query("SELECT key FROM app_settings WHERE key = ?")
      .all("retention_days") as { key: string }[];
    expect(rows).toEqual([]);
  });

  test("GET never returns an unmasked class C value, even immediately after a rejected write attempt naming it", async () => {
    await withEnv({ PASSKEY: "req5-real-passkey-should-never-leak-3f9c" }, async () => {
      const relDb = join(uniqueDir("req5-masked-get"), "runtime.db");
      initDb(relDb);

      await settingsRouter.request("/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passkey: "attacker-value" }),
      });

      const res = await settingsRouter.request("/");
      const body = (await res.json()) as { settings: Record<string, { value: unknown; masked: boolean }> };

      expect(body.settings.passkey.value).toBe("***");
      expect(body.settings.passkey.masked).toBe(true);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("req5-real-passkey-should-never-leak-3f9c");
      expect(raw).not.toContain("attacker-value");
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 6: a genuinely unreadable database fails closed — safe
// defaults, not env, not a permissive default — and does not throw.
// ---------------------------------------------------------------------------

describe("requirement 6: a degraded database falls back to the safe default, ignoring a permissive environment", () => {
  function seedCorruptDatabase(relDbPath: string): void {
    const abs = absDbPath(relDbPath);
    mkdirSync(dirname(abs), { recursive: true });
    // Deliberately not a valid SQLite file at all, the same technique
    // tests/p3-settings-substrate-reconciliation.test.ts uses: bun:sqlite
    // opens this lazily and only fails on the first query, which is what
    // exercises the real degraded-database code path end to end rather than
    // a mocked failure.
    writeFileSync(abs, "this is deliberately not a sqlite database file");
  }

  test("outbound policy stays deny-by-default when app_settings cannot be read, even though env vars ask for the permissive posture", async () => {
    await withEnv(
      { ALLOW_PRIVATE_FETCHES: "true", OUTBOUND_FETCH_ALLOWLIST: "10.8.8.8" },
      async () => {
        const relDb = join(uniqueDir("req6-outbound"), "runtime.db");
        seedCorruptDatabase(relDb);
        initDb(relDb);
        expect(getDatabaseReadiness().ready).toBe(false);

        const options = getGlobalFetchPolicyOptions();
        expect(options.allowPrivateFetches).toBe(false);
        expect(options.allowlist ?? []).toEqual([]);

        // Assert the *decision*, not just the getter's return value: even
        // the env-named host must still be refused, because the effective
        // allowlist fell back to empty rather than to the environment.
        await expect(
          assertAndResolveOutboundTarget("http://10.8.8.8/internal", options),
        ).rejects.toThrow(/private|reserved/i);
      },
    );
  });

  test("resolveFetchPolicy does not throw when the database is degraded", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: "true" }, async () => {
      const relDb = join(uniqueDir("req6-fetchpolicy"), "runtime.db");
      seedCorruptDatabase(relDb);
      initDb(relDb);
      expect(getDatabaseReadiness().ready).toBe(false);

      expect(() => resolveFetchPolicy({})).not.toThrow();
    });
  });

  test("a healthy database is unaffected by the fallback path (contrast case)", async () => {
    await withEnv({ ALLOW_PRIVATE_FETCHES: "true" }, async () => {
      const relDb = join(uniqueDir("req6-healthy"), "runtime.db");
      initDb(relDb);
      expect(getDatabaseReadiness().ready).toBe(true);

      // No stored value, DB is healthy: env is consulted normally (this is
      // requirement 4's "env beats default", repeated here only to make the
      // contrast with the degraded case explicit within requirement 6).
      await expect(
        assertAndResolveOutboundTarget("http://10.8.8.9/internal", getGlobalFetchPolicyOptions()),
      ).resolves.toEqual({ address: "10.8.8.9" });
    });
  });
});
