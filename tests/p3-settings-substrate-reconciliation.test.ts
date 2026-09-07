// Test suite for slice p3-settings-substrate-reconciliation.
//
// Requirements exercised (see docs/tdd/p3-settings-substrate-reconciliation.md):
//   1. Exactly one live settings table; the dead `settings` table is dropped
//      by a migration that carries its data into the live table first.
//   2. Reading/writing a setting through one accessor round-trips exactly,
//      including quotes, newlines, and non-ASCII characters.
//   3/4. A degraded database (cannot be opened or migrated) is reported
//      through a readiness surface instead of only being thrown into logs;
//      a healthy database reports ready.
//   5. Migrations are idempotent against a real SQLite file.
//   6. A database seeded at an older migration checkpoint still opens and
//      migrates forward via the real startup path.
//   7. A documented backup/restore procedure exists and actually works.
//
// Design decisions made by this test (flagged for lead review, since the
// brief explicitly left them open):
//   - Readiness is a new, anonymous `GET /readyz` endpoint (not folded into
//     the session-gated `routes/health.ts`), because a readiness probe that
//     requires a session is useless to a container orchestrator — the brief
//     makes exactly this point about `ANONYMOUS_ROUTES`.
//   - Contract: 200 `{ ready: true }` when healthy; 503
//     `{ ready: false, reason: string }` when degraded. `reason` must not
//     contain the database's absolute filesystem path.
//   - Backup/restore must be documented at
//     `docs/operations/database-backup-restore.md`, with a heading
//     mentioning "backup", a heading mentioning "restore", and a fenced
//     ts/typescript code block containing
//     `import { <backupFn>, <restoreFn> } from "<modulePath>"` where one
//     named import matches /backup/i and the other /restore/i. The test
//     dynamically imports that exact module/name pair and calls them, so a
//     renamed export or a moved module fails the test (documentation
//     drift), not just a missing doc file.
//   - Documented function signatures this test drives:
//       backupFn(sqlite: Database, destinationPath: string): Promise<void> | void
//       restoreFn(backupPath: string, destinationPath: string): Promise<void> | void
//     chosen to match the existing `lib/analytics/db.ts` convention of
//     taking an open `Database` first (see `insertRunLog`, `getAppSettings`).

import { describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../lib/analytics/schema";
import { getAppSettings, getDb, initDb, saveAppSettings } from "../lib/analytics/db";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REAL_MIGRATIONS_DIR = join(REPO_ROOT, "drizzle", "migrations");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const REAL_JOURNAL: Journal = JSON.parse(
  readFileSync(join(REAL_MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

let tmpCounter = 0;
/** A fresh, collision-free relative directory under .tdd-state for this slice's fixtures. */
function uniqueDir(label: string): string {
  tmpCounter += 1;
  return join(".tdd-state", "_p3-settings-substrate", `${label}-${Date.now()}-${tmpCounter}`);
}

/** Mirrors initDb()'s own `join(process.cwd(), dbPath)` so tests can reach the same file. */
function absDbPath(relDbPath: string): string {
  return join(process.cwd(), relDbPath);
}

/**
 * A standalone migrations folder containing only the journal entries up to
 * and including `uptoTag`, with the shipped .sql files copied byte-for-byte
 * and original timestamps preserved. Lets a test seed "a database created by
 * an older schema" using the real migration files rather than hand-written
 * SQL that could drift from what actually ships.
 */
function buildLegacyMigrationsFolder(uptoTag: string): string {
  const dir = join(REPO_ROOT, uniqueDir(`legacy-migrations-${uptoTag}`));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const entries: JournalEntry[] = [];
  let found = false;
  for (const entry of REAL_JOURNAL.entries) {
    entries.push(entry);
    const sql = readFileSync(join(REAL_MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    writeFileSync(join(dir, `${entry.tag}.sql`), sql);
    if (entry.tag === uptoTag) {
      found = true;
      break;
    }
  }
  if (!found) {
    throw new Error(`buildLegacyMigrationsFolder: no journal entry with tag '${uptoTag}' found`);
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: REAL_JOURNAL.version, dialect: REAL_JOURNAL.dialect, entries }),
  );
  return dir;
}

/** Applies only the migrations up to `uptoTag` to a real file, simulating an older install. */
function seedLegacyDb(relDbPath: string, uptoTag: string): void {
  const abs = absDbPath(relDbPath);
  mkdirSync(dirname(abs), { recursive: true });
  const sqlite = new Database(abs);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: buildLegacyMigrationsFolder(uptoTag) });
  sqlite.close();
}

function tableNames(sqlite: Database): string[] {
  return (sqlite.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
    name: string;
  }[]).map((r) => r.name);
}

function readRawKeyValueRows(sqlite: Database, table: "settings" | "app_settings"): Record<string, string> {
  const rows = sqlite.query(`SELECT key, value FROM ${table}`).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Requirement 1: exactly one settings table, with a real migration carrying
// data from the dead table before dropping it.
// ---------------------------------------------------------------------------

describe("requirement 1: one settings table (schema.ts + drizzle/migrations)", () => {
  test("a fresh install ends up with app_settings live and no dead 'settings' table", () => {
    const relDb = join(uniqueDir("fresh"), "runtime.db");
    initDb(relDb);
    const names = tableNames(getDb());
    expect(names).toContain("app_settings");
    expect(names).not.toContain("settings");
  });

  test("rows seeded in the dead 'settings' table are carried into app_settings rather than dropped", () => {
    const relDb = join(uniqueDir("carryover"), "runtime.db");
    seedLegacyDb(relDb, "0000_ordinary_hannibal_king");

    const seedSqlite = new Database(absDbPath(relDb));
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("site_name", "My Feed Site");
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("retention_days", "30");
    seedSqlite.close();

    initDb(relDb);
    const sqlite = getDb();
    expect(tableNames(sqlite)).not.toContain("settings");
    const carried = readRawKeyValueRows(sqlite, "app_settings");
    expect(carried.site_name).toBe("My Feed Site");
    expect(carried.retention_days).toBe("30");
  });

  test("on a key present in both tables, the live app_settings value wins over the dead settings value", () => {
    const relDb = join(uniqueDir("conflict"), "runtime.db");
    seedLegacyDb(relDb, "0002_app_settings");

    const seedSqlite = new Database(absDbPath(relDb));
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("retention_days", "999");
    seedSqlite.query("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("retention_days", "45");
    seedSqlite.close();

    initDb(relDb);
    const rows = readRawKeyValueRows(getDb(), "app_settings");
    expect(rows.retention_days).toBe("45");
  });

  test("carry-over happens even when app_settings starts out empty, and the drop still removes the dead table", () => {
    const relDb = join(uniqueDir("emptylive"), "runtime.db");
    seedLegacyDb(relDb, "0002_app_settings");

    const seedSqlite = new Database(absDbPath(relDb));
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("only_in_dead_table", "still-here");
    seedSqlite.close();

    initDb(relDb);
    const sqlite = getDb();
    expect(readRawKeyValueRows(sqlite, "app_settings").only_in_dead_table).toBe("still-here");
    expect(tableNames(sqlite)).not.toContain("settings");
  });
});

// ---------------------------------------------------------------------------
// Requirement 2: one accessor, exact round trip.
// ---------------------------------------------------------------------------

describe("requirement 2: one accessor round-trips exact values", () => {
  function makeMemoryDb(): Database {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle/migrations" });
    return sqlite;
  }

  test("round-trips a value containing quotes, newlines, and non-ASCII characters exactly", async () => {
    const sqlite = makeMemoryDb();
    const tricky = 'line one\nline two "quoted" \'single\' — 世界 🎉 \\backslash\\ \t tab';
    await saveAppSettings(sqlite, { weird_value: tricky });
    const read = await getAppSettings(sqlite);
    expect(read.weird_value).toBe(tricky);
  });

  test("round-trips an empty string without coercing it to null or dropping the key", async () => {
    const sqlite = makeMemoryDb();
    await saveAppSettings(sqlite, { empty_value: "" });
    const read = await getAppSettings(sqlite);
    expect(read.empty_value).toBe("");
  });

  test("writing the same key twice overwrites in place rather than duplicating rows", async () => {
    const sqlite = makeMemoryDb();
    await saveAppSettings(sqlite, { k: "first" });
    await saveAppSettings(sqlite, { k: "second" });
    const count = sqlite.query("SELECT COUNT(*) as n FROM app_settings WHERE key = 'k'").get() as { n: number };
    expect(count.n).toBe(1);
    expect((await getAppSettings(sqlite)).k).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// Requirement 5: idempotent, safe to re-run against a real file.
// ---------------------------------------------------------------------------

describe("requirement 5: migrations are idempotent against a real SQLite file", () => {
  test("running initDb twice against the same real file is a no-op the second time", async () => {
    const relDb = join(uniqueDir("idempotent"), "runtime.db");
    initDb(relDb);
    await saveAppSettings(getDb(), { marker: "before-second-init" });
    const before = tableNames(getDb());

    initDb(relDb);
    const after = tableNames(getDb());

    expect(after).toEqual(before);
    expect((await getAppSettings(getDb())).marker).toBe("before-second-init");
  });

  test("re-running migrate() directly against the same real file twice does not error or duplicate schema objects", () => {
    const relDb = join(uniqueDir("idempotent-raw"), "runtime.db");
    const abs = absDbPath(relDb);
    mkdirSync(dirname(abs), { recursive: true });
    const sqlite = new Database(abs);
    const db = drizzle(sqlite, { schema });

    migrate(db, { migrationsFolder: "./drizzle/migrations" });
    const firstRun = tableNames(sqlite);

    expect(() => migrate(db, { migrationsFolder: "./drizzle/migrations" })).not.toThrow();
    expect(tableNames(sqlite)).toEqual(firstRun);
  });
});

// ---------------------------------------------------------------------------
// Requirement 6: a database created by an older schema still opens and
// migrates forward via the real startup path (initDb), not a hand-written
// re-implementation of the old schema.
// ---------------------------------------------------------------------------

describe("requirement 6: lazy migration from an older schema checkpoint", () => {
  test("seeded at migration 0000 (run_logs + dead settings only), initDb migrates all the way forward", async () => {
    const relDb = join(uniqueDir("lazy-0000"), "runtime.db");
    seedLegacyDb(relDb, "0000_ordinary_hannibal_king");

    const seedSqlite = new Database(absDbPath(relDb));
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("legacy_key", "legacy_value");
    seedSqlite.close();

    expect(() => initDb(relDb)).not.toThrow();

    const sqlite = getDb();
    const names = tableNames(sqlite);
    expect(names).toContain("app_settings");
    expect(names).toContain("feed_history_items");
    expect(names).toContain("feed_history_snapshots");
    expect(names).not.toContain("settings");
    expect(readRawKeyValueRows(sqlite, "app_settings").legacy_key).toBe("legacy_value");
  });

  test("seeded at migration 0001 (pre-app_settings), initDb creates app_settings and it is immediately usable", async () => {
    const relDb = join(uniqueDir("lazy-0001"), "runtime.db");
    seedLegacyDb(relDb, "0001_hot_kang");

    expect(() => initDb(relDb)).not.toThrow();

    const sqlite = getDb();
    expect(tableNames(sqlite)).toContain("app_settings");
    await saveAppSettings(sqlite, { post_migration_write: "ok" });
    expect((await getAppSettings(sqlite)).post_migration_write).toBe("ok");
  });

  test("seeded at migration 0002 (today's shipped shape, both tables present), initDb consolidates them", async () => {
    const relDb = join(uniqueDir("lazy-0002"), "runtime.db");
    seedLegacyDb(relDb, "0002_app_settings");

    const seedSqlite = new Database(absDbPath(relDb));
    seedSqlite.query("INSERT INTO settings (key, value) VALUES (?, ?)").run("from_dead_table", "still-alive");
    seedSqlite.close();

    expect(() => initDb(relDb)).not.toThrow();

    const sqlite = getDb();
    expect(readRawKeyValueRows(sqlite, "app_settings").from_dead_table).toBe("still-alive");
    expect(tableNames(sqlite)).not.toContain("settings");
  });
});

// ---------------------------------------------------------------------------
// Requirements 3 & 4: readiness surface distinguishes healthy from degraded.
// Driven against the real running server (subprocess over loopback TCP),
// the same way tests/auth-trust-boundary.test.ts exercises the real mount
// order rather than a hand-rolled reimplementation.
// ---------------------------------------------------------------------------

describe("requirements 3 & 4: readiness surface (GET /readyz)", () => {
  const PORT = 5000;
  const BASE_URL = `http://localhost:${PORT}`;
  const BASE_SECRETS = {
    PASSKEY: "p3-settings-substrate-test-passkey",
    COOKIE_SECRET: "p3-settings-substrate-cookie-secret-32ch",
    ENCRYPTION_KEY: "p3-settings-substrate-encrypt-key-32char",
  };

  async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        await res.body?.cancel();
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    throw new Error(`mkfd server did not become ready at ${url}: ${String(lastErr)}`);
  }

  async function spawnServer(relDbPath: string): Promise<Subprocess> {
    const proc = Bun.spawn([process.execPath, "index.ts"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...BASE_SECRETS,
        RUNTIME_DB_PATH: relDbPath,
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    await waitForServer(`${BASE_URL}/passkey`);
    return proc;
  }

  async function stopServer(proc: Subprocess | undefined): Promise<void> {
    if (!proc) return;
    proc.kill();
    await proc.exited;
  }

  test("a healthy database reports ready via anonymous GET /readyz", async () => {
    const proc = await spawnServer(`./${join(uniqueDir("readyz-healthy"), "runtime.db")}`);
    try {
      const res = await fetch(`${BASE_URL}/readyz`, { redirect: "manual" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ready: boolean };
      expect(body.ready).toBe(true);
    } finally {
      await stopServer(proc);
    }
  });

  test("a database that cannot be opened/migrated reports not-ready with a reason, without leaking its filesystem path, and the process keeps serving requests", async () => {
    const relDb = join(uniqueDir("readyz-degraded"), "runtime.db");
    const abs = absDbPath(relDb);
    mkdirSync(dirname(abs), { recursive: true });
    // Deliberately not a valid SQLite file at all: guarantees initDb() cannot
    // open or migrate it, without depending on any particular migration's SQL.
    writeFileSync(abs, "this is deliberately not a sqlite database file");

    const proc = await spawnServer(`./${relDb}`);
    try {
      // Requirement 3: a degraded database must be observable, not fatal.
      // The process must still be alive and answering HTTP.
      const passkeyRes = await fetch(`${BASE_URL}/passkey`);
      expect(passkeyRes.status).toBeLessThan(500);

      const res = await fetch(`${BASE_URL}/readyz`, { redirect: "manual" });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { ready: boolean; reason?: string };
      expect(body.ready).toBe(false);
      expect(typeof body.reason).toBe("string");
      expect((body.reason ?? "").length).toBeGreaterThan(0);

      const reason = body.reason ?? "";
      expect(reason).not.toContain(abs);
      expect(reason).not.toContain(REPO_ROOT);
      expect(reason).not.toMatch(/[A-Za-z]:[\\/][^\s"']*runtime\.db/i);
    } finally {
      await stopServer(proc);
    }
  });

  test("/readyz is reachable without a session cookie and does not redirect to /passkey", async () => {
    const proc = await spawnServer(`./${join(uniqueDir("readyz-anon"), "runtime.db")}`);
    try {
      const res = await fetch(`${BASE_URL}/readyz`, { redirect: "manual" });
      expect(res.status).not.toBe(302);
      expect(res.headers.get("location") ?? "").not.toContain("/passkey");
    } finally {
      await stopServer(proc);
    }
  });

  test("readiness stays healthy across a restart against the same real database file (concurrency/restart)", async () => {
    const relDb = `./${join(uniqueDir("readyz-restart"), "runtime.db")}`;

    let proc = await spawnServer(relDb);
    try {
      const first = await fetch(`${BASE_URL}/readyz`, { redirect: "manual" });
      expect(first.status).toBe(200);
    } finally {
      await stopServer(proc);
    }

    proc = await spawnServer(relDb);
    try {
      const second = await fetch(`${BASE_URL}/readyz`, { redirect: "manual" });
      expect(second.status).toBe(200);
      const body = (await second.json()) as { ready: boolean };
      expect(body.ready).toBe(true);
    } finally {
      await stopServer(proc);
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 7: backup/restore are documented and the documented procedure
// works. The test parses the documented interface (module + export names)
// and drives it directly, so a renamed export or moved module fails the
// test as documentation drift — not just a missing file.
// ---------------------------------------------------------------------------

describe("requirement 7: documented backup/restore procedure works as documented", () => {
  const DOC_PATH = join(REPO_ROOT, "docs", "operations", "database-backup-restore.md");

  interface DocumentedInterface {
    modulePath: string;
    backupExport: string;
    restoreExport: string;
  }

  function extractDocumentedInterface(): DocumentedInterface {
    if (!existsSync(DOC_PATH)) {
      throw new Error(
        `Expected backup/restore documentation at ${relative(REPO_ROOT, DOC_PATH)}. ` +
          `Requirement 7 requires the procedure to be documented, and this test drives ` +
          `whatever the documentation says to do.`,
      );
    }
    const text = readFileSync(DOC_PATH, "utf8");

    const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1]);
    if (!headings.some((h) => /backup/i.test(h))) {
      throw new Error(`${relative(REPO_ROOT, DOC_PATH)} has no heading mentioning "backup".`);
    }
    if (!headings.some((h) => /restore/i.test(h))) {
      throw new Error(`${relative(REPO_ROOT, DOC_PATH)} has no heading mentioning "restore".`);
    }

    const codeBlocks = [...text.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].map((m) => m[1]);
    let importMatch: RegExpExecArray | null = null;
    for (const block of codeBlocks) {
      const match = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/.exec(block);
      if (match) {
        importMatch = match;
        break;
      }
    }
    if (!importMatch) {
      throw new Error(
        `${relative(REPO_ROOT, DOC_PATH)} must contain a fenced ts/typescript code block with an ` +
          `\`import { ... } from "..."\` naming the backup and restore functions, e.g. ` +
          `\`import { backupDatabase, restoreDatabase } from "../../lib/analytics/db"\`.`,
      );
    }

    const names = importMatch[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const backupExport = names.find((n) => /backup/i.test(n));
    const restoreExport = names.find((n) => /restore/i.test(n));
    if (!backupExport || !restoreExport) {
      throw new Error(
        `Expected the documented import in ${relative(REPO_ROOT, DOC_PATH)} to name both a backup ` +
          `and a restore function; found: ${names.join(", ") || "(none)"}.`,
      );
    }

    return { modulePath: importMatch[2], backupExport, restoreExport };
  }

  async function loadDocumentedFunctions(): Promise<{
    backupFn: (...args: unknown[]) => unknown;
    restoreFn: (...args: unknown[]) => unknown;
  }> {
    const { modulePath, backupExport, restoreExport } = extractDocumentedInterface();
    const resolvedModulePath = resolve(dirname(DOC_PATH), modulePath);
    const mod = (await import(pathToFileURL(resolvedModulePath).href)) as Record<string, unknown>;

    const backupFn = mod[backupExport];
    const restoreFn = mod[restoreExport];
    if (typeof backupFn !== "function") {
      throw new Error(
        `Documentation says the backup function is '${backupExport}' from '${modulePath}', but that ` +
          `module does not export a function with that name — documentation has drifted from the implementation.`,
      );
    }
    if (typeof restoreFn !== "function") {
      throw new Error(
        `Documentation says the restore function is '${restoreExport}' from '${modulePath}', but that ` +
          `module does not export a function with that name — documentation has drifted from the implementation.`,
      );
    }
    return {
      backupFn: backupFn as (...args: unknown[]) => unknown,
      restoreFn: restoreFn as (...args: unknown[]) => unknown,
    };
  }

  test("the documented backup function produces a standalone, independently-openable SQLite file", async () => {
    const { backupFn } = await loadDocumentedFunctions();

    const sourceRel = join(uniqueDir("backup-source"), "runtime.db");
    initDb(sourceRel);
    await saveAppSettings(getDb(), { retention_days: "77", tricky: 'line1\nline2 "q" 世界' });

    const backupAbs = join(REPO_ROOT, uniqueDir("backup-dest"), "runtime-backup.db");
    mkdirSync(dirname(backupAbs), { recursive: true });
    await backupFn(getDb(), backupAbs);

    expect(existsSync(backupAbs)).toBe(true);
    const backupSqlite = new Database(backupAbs, { readonly: true });
    try {
      const rows = readRawKeyValueRows(backupSqlite, "app_settings");
      expect(rows.retention_days).toBe("77");
      expect(rows.tricky).toBe('line1\nline2 "q" 世界');
    } finally {
      backupSqlite.close();
    }
  });

  test("the documented restore function makes a backed-up database's data intact and readable by the app again", async () => {
    const { backupFn, restoreFn } = await loadDocumentedFunctions();

    const sourceRel = join(uniqueDir("restore-source"), "runtime.db");
    initDb(sourceRel);
    await saveAppSettings(getDb(), { restore_marker: "present-after-restore" });

    const backupAbs = join(REPO_ROOT, uniqueDir("restore-backup"), "runtime-backup.db");
    mkdirSync(dirname(backupAbs), { recursive: true });
    await backupFn(getDb(), backupAbs);

    const restoredRel = join(uniqueDir("restore-target"), "runtime.db");
    const restoredAbs = absDbPath(restoredRel);
    mkdirSync(dirname(restoredAbs), { recursive: true });
    await restoreFn(backupAbs, restoredAbs);

    initDb(restoredRel);
    const restored = await getAppSettings(getDb());
    expect(restored.restore_marker).toBe("present-after-restore");
  });
});
