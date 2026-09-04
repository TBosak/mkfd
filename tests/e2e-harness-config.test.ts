import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// This suite specifies the cross-platform / credential-contract behavior of
// the Playwright E2E launch harness (roadmap Packet 1, findings C12 + H3).
//
// It never depends on a running Mkfd server or browser: it loads the *real*
// `frontend/playwright.config.ts` in a fresh subprocess (mirroring exactly
// how Playwright's own runner loads the config file) and inspects the
// resolved config object plus the checked-in source of the files this slice
// owns. That keeps the RED reason tied to the harness contract itself
// (POSIX-only inline env assignment, committed literals, missing env-based
// secret delivery) rather than to "no server/browser is running".
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");

const LEGACY_LITERALS = [
  "admin123",
  "a18c1fd2211edd76a18c1fd2211edd76",
  "a18c1fd2211edd76",
];

// Shortest common text encoding of 32 random bytes (unpadded base64 / base64url).
// Any encoding at least this compact yields a string at least this long, so this
// is an encoding-agnostic floor for the "at least 32 random bytes" requirement.
const MIN_SECRET_LENGTH = 43;

const RESET_ENV_KEYS = [
  "CI",
  "PASSKEY",
  "COOKIE_SECRET",
  "ENCRYPTION_KEY",
  "MKFD_E2E_PASSKEY",
  "MKFD_E2E_COOKIE_SECRET",
  "MKFD_E2E_ENCRYPTION_KEY",
];

// A non-secret adversarial value reused across override/dataflow assertions:
// contains spaces and shell metacharacters that must survive as a literal
// environment value rather than being interpreted as a command.
const META_VALUE = 'value with spaces & "quotes" $(echo pwned) ; rm -rf / | cat `backtick`';

interface WebServerEntry {
  command: string;
  port: number;
  reuseExistingServer?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

interface PlaywrightConfigShape {
  retries?: number;
  workers?: number;
  use?: { baseURL?: string };
  webServer?: WebServerEntry[];
}

interface PublishedEnv {
  MKFD_E2E_PASSKEY?: string;
  MKFD_E2E_COOKIE_SECRET?: string;
  MKFD_E2E_ENCRYPTION_KEY?: string;
}

interface LoadResult {
  exitCode: number;
  config: PlaywrightConfigShape | null;
  // The MKFD_E2E_* values as seen via `process.env` inside the *same*
  // process that loaded the config - i.e. what a Playwright worker process
  // (which inherits the config-loading process's environment) would see,
  // and therefore what `frontend/e2e/fixtures.ts` reads at test time.
  publishedEnv: PublishedEnv | null;
  stderr: string;
}

/**
 * Loads `frontend/playwright.config.ts` in a fresh `bun` subprocess with a
 * controlled, isolated environment - exactly the platform-neutral mechanism
 * Playwright itself uses to spawn webServer commands (no shell interpolation).
 */
function loadPlaywrightConfig(envOverrides: Record<string, string> = {}): LoadResult {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of RESET_ENV_KEYS) delete env[key];
  for (const [key, value] of Object.entries(envOverrides)) env[key] = value;

  const loaderCode =
    "import('./playwright.config.ts')" +
    ".then(m => { process.stdout.write(JSON.stringify({" +
    "  config: m.default," +
    "  publishedEnv: {" +
    "    MKFD_E2E_PASSKEY: process.env.MKFD_E2E_PASSKEY," +
    "    MKFD_E2E_COOKIE_SECRET: process.env.MKFD_E2E_COOKIE_SECRET," +
    "    MKFD_E2E_ENCRYPTION_KEY: process.env.MKFD_E2E_ENCRYPTION_KEY," +
    "  }," +
    "})); process.exit(0); })" +
    ".catch(e => { console.error(String((e && e.stack) || e)); process.exit(1); })";

  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", loaderCode],
    cwd: FRONTEND_DIR,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = proc.stderr.toString();
  const exitCode = proc.exitCode ?? 1;
  let config: PlaywrightConfigShape | null = null;
  let publishedEnv: PublishedEnv | null = null;
  if (exitCode === 0) {
    try {
      const parsed = JSON.parse(proc.stdout.toString());
      config = parsed.config ?? null;
      publishedEnv = parsed.publishedEnv ?? null;
    } catch {
      config = null;
      publishedEnv = null;
    }
  }
  return { exitCode, config, publishedEnv, stderr };
}

function getServerByPort(config: PlaywrightConfigShape | null, port: number): WebServerEntry {
  const server = config?.webServer?.find((entry) => entry.port === port);
  if (!server) {
    throw new Error(`no webServer entry found for port ${port}`);
  }
  return server;
}

function hasPosixInlineEnvAssignment(command: string): boolean {
  // Matches one or more leading `NAME=value` tokens before the real command,
  // e.g. "PASSKEY=admin123 COOKIE_SECRET=... bun index.ts".
  return /^\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+\S/.test(command);
}

function hasShellChaining(command: string): boolean {
  return /[;&|]/.test(command);
}

// Commands that hand off to one of these executables only run on the shell
// that ships them; a command with no inline assignment and no chaining
// character can still be Windows- or POSIX-only this way (e.g. `bash run.sh`,
// `sh -c "..."`, `powershell -Command "..."`).
const PLATFORM_SHELL_EXECUTABLES = new Set([
  "sh",
  "bash",
  "zsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

function extractFirstCommandToken(command: string): string {
  const trimmed = command.trim();
  const quoteChar = trimmed[0];
  if (quoteChar === '"' || quoteChar === "'") {
    // A quoted first token (e.g. `"C:\Program Files\PowerShell\7\pwsh.exe" -File run.ps1`)
    // can contain spaces, so it must be matched to its closing quote rather
    // than split on whitespace.
    const closingIndex = trimmed.indexOf(quoteChar, 1);
    if (closingIndex !== -1) {
      return trimmed.slice(1, closingIndex);
    }
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

function usesPlatformSpecificShellWrapper(command: string): boolean {
  const firstToken = extractFirstCommandToken(command);
  const executable = (firstToken.split(/[\\/]/).pop() ?? "").toLowerCase();
  return PLATFORM_SHELL_EXECUTABLES.has(executable);
}

/**
 * Proves source-level dataflow from `process.env.MKFD_E2E_PASSKEY` to a
 * `page.fill(...)` call targeting a passkey-looking locator - either inline,
 * or via a local variable assigned from that env read with no `??`/`||`
 * literal fallback. A bare textual reference to the env var elsewhere in the
 * file (an unused declaration, a comment) does not satisfy this: the value
 * must actually be the argument passed to `page.fill`.
 */
function fixturePasskeyFillArgumentSourcesFromEnv(source: string): boolean {
  const cleanEnvVarNames = new Set<string>();
  const assignmentPattern =
    /\b(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.MKFD_E2E_PASSKEY\b(?!\s*(\?\?|\|\|))/g;
  for (const assignmentMatch of source.matchAll(assignmentPattern)) {
    cleanEnvVarNames.add(assignmentMatch[1]);
  }

  const normalizeArg = (raw: string): string =>
    raw
      .trim()
      .replace(/!$/, "")
      .replace(/\s+as\s+string$/, "");

  const fillCallPattern = /page\.fill\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g;
  for (const fillMatch of source.matchAll(fillCallPattern)) {
    const [, locatorArg, valueArgRaw] = fillMatch;
    if (!/passkey/i.test(locatorArg)) continue;
    const valueArg = normalizeArg(valueArgRaw);
    if (valueArg === "process.env.MKFD_E2E_PASSKEY") return true;
    if (cleanEnvVarNames.has(valueArg)) return true;
  }
  return false;
}

describe("frontend/playwright.config.ts webServer command syntax", () => {
  test("frontend dev server command has no POSIX inline env assignment", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const frontend = getServerByPort(config, 5173);
    expect(hasPosixInlineEnvAssignment(frontend.command)).toBe(false);
  });

  test("backend server command has no POSIX inline env assignment", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(hasPosixInlineEnvAssignment(backend.command)).toBe(false);
  });

  test("frontend dev server command has no shell chaining metacharacters", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const frontend = getServerByPort(config, 5173);
    expect(hasShellChaining(frontend.command)).toBe(false);
  });

  test("backend server command has no shell chaining metacharacters", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(hasShellChaining(backend.command)).toBe(false);
  });

  test("frontend dev server command does not delegate to a platform-specific shell wrapper", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const frontend = getServerByPort(config, 5173);
    expect(usesPlatformSpecificShellWrapper(frontend.command)).toBe(false);
  });

  test("backend server command does not delegate to a platform-specific shell wrapper", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(usesPlatformSpecificShellWrapper(backend.command)).toBe(false);
  });
});

// The `usesPlatformSpecificShellWrapper` detector above is what the two tests
// just above use to judge conformance, so its own edge-case correctness is
// pinned down directly: a naive "split on first space" implementation would
// misdetect a quoted absolute path (mistaking `"C:\Program` for the
// executable) and let a Windows-only PowerShell wrapper through undetected.
describe("usesPlatformSpecificShellWrapper helper correctness", () => {
  test("rejects a quoted absolute path to a platform-specific shell executable", () => {
    expect(
      usesPlatformSpecificShellWrapper('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -File run.ps1'),
    ).toBe(true);
  });

  test("rejects a quoted absolute POSIX path to a platform-specific shell executable", () => {
    expect(usesPlatformSpecificShellWrapper('"/usr/bin/bash" run-backend.sh')).toBe(true);
  });

  test("rejects an unquoted platform-specific shell executable", () => {
    expect(usesPlatformSpecificShellWrapper("bash run-backend.sh")).toBe(true);
    expect(usesPlatformSpecificShellWrapper('sh -c "bun index.ts"')).toBe(true);
  });

  test("allows a direct bun command", () => {
    expect(usesPlatformSpecificShellWrapper("bun index.ts")).toBe(false);
    expect(usesPlatformSpecificShellWrapper("bun run dev")).toBe(false);
  });
});

describe("secret delivery via Playwright's platform-neutral env mechanism", () => {
  test("backend webServer entry declares a nonempty PASSKEY, COOKIE_SECRET, ENCRYPTION_KEY via env", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env, "backend webServer entry must declare env for secret delivery").toBeTruthy();
    for (const key of ["PASSKEY", "COOKIE_SECRET", "ENCRYPTION_KEY"] as const) {
      expect(typeof backend.env?.[key]).toBe("string");
      expect((backend.env?.[key] ?? "").length).toBeGreaterThan(0);
    }
  });

  test("default PASSKEY is generated, not the legacy committed literal", () => {
    const { config } = loadPlaywrightConfig();
    const backend = getServerByPort(config, 5000);
    expect((backend.env?.PASSKEY ?? "").length).toBeGreaterThan(0);
    expect(backend.env?.PASSKEY).not.toBe("admin123");
  });

  test("default COOKIE_SECRET and ENCRYPTION_KEY are generated, not legacy literals, and meet the 32-random-byte length floor", () => {
    const { config } = loadPlaywrightConfig();
    const backend = getServerByPort(config, 5000);
    for (const key of ["COOKIE_SECRET", "ENCRYPTION_KEY"] as const) {
      const value = backend.env?.[key] ?? "";
      expect(LEGACY_LITERALS).not.toContain(value);
      expect(value.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    }
  });

  test("two independent default config loads do not reuse the same generated credentials", () => {
    const first = loadPlaywrightConfig();
    const second = loadPlaywrightConfig();
    const a = getServerByPort(first.config, 5000);
    const b = getServerByPort(second.config, 5000);
    expect(a.env?.PASSKEY).not.toBe(b.env?.PASSKEY);
    expect(a.env?.COOKIE_SECRET).not.toBe(b.env?.COOKIE_SECRET);
    expect(a.env?.ENCRYPTION_KEY).not.toBe(b.env?.ENCRYPTION_KEY);
  });
});

describe("MKFD_E2E_* overrides", () => {
  test("MKFD_E2E_PASSKEY override reaches backend PASSKEY exactly, including shell metacharacters", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ MKFD_E2E_PASSKEY: META_VALUE });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env?.PASSKEY).toBe(META_VALUE);
  });

  test("MKFD_E2E_COOKIE_SECRET override reaches backend COOKIE_SECRET exactly, including shell metacharacters", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ MKFD_E2E_COOKIE_SECRET: META_VALUE });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env?.COOKIE_SECRET).toBe(META_VALUE);
  });

  test("MKFD_E2E_ENCRYPTION_KEY override reaches backend ENCRYPTION_KEY exactly, including shell metacharacters", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ MKFD_E2E_ENCRYPTION_KEY: META_VALUE });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env?.ENCRYPTION_KEY).toBe(META_VALUE);
  });

  test("overriding only PASSKEY leaves COOKIE_SECRET and ENCRYPTION_KEY independently generated", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ MKFD_E2E_PASSKEY: "fixed-ci-passkey" });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env?.PASSKEY).toBe("fixed-ci-passkey");
    expect(backend.env?.COOKIE_SECRET).not.toBe("fixed-ci-passkey");
    expect(backend.env?.ENCRYPTION_KEY).not.toBe("fixed-ci-passkey");
    expect((backend.env?.COOKIE_SECRET ?? "").length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect((backend.env?.ENCRYPTION_KEY ?? "").length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  });

  test("overriding only COOKIE_SECRET leaves PASSKEY and ENCRYPTION_KEY independently generated", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ MKFD_E2E_COOKIE_SECRET: "fixed-ci-cookie-secret" });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(backend.env?.COOKIE_SECRET).toBe("fixed-ci-cookie-secret");
    expect(backend.env?.PASSKEY).not.toBe("");
    expect(backend.env?.PASSKEY).not.toBe("admin123");
    expect((backend.env?.ENCRYPTION_KEY ?? "").length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(backend.env?.ENCRYPTION_KEY).not.toBe("fixed-ci-cookie-secret");
  });

  // An empty-string override is only acceptably rejected two ways: silently
  // regenerate a valid value, or fail with a *stable, variable-identifying*
  // diagnostic. A bare nonzero exit with arbitrary stderr (a stray syntax
  // error, a missing import, a random crash) must NOT count as "clear and
  // deterministic" rejection, so on the failure branch we require the
  // diagnostic to (a) name the affected variable, (b) describe an
  // empty/invalid/required condition, and (c) be byte-identical across two
  // independent runs with the same input (ruling out e.g. embedded stack
  // traces with addresses/timestamps that vary run to run).
  function expectEmptyOverrideRejectedCleanly(
    envVarName: "MKFD_E2E_PASSKEY" | "MKFD_E2E_COOKIE_SECRET" | "MKFD_E2E_ENCRYPTION_KEY",
    backendKey: "PASSKEY" | "COOKIE_SECRET" | "ENCRYPTION_KEY",
  ): void {
    const first = loadPlaywrightConfig({ [envVarName]: "" });
    if (first.exitCode === 0) {
      const backend = getServerByPort(first.config, 5000);
      const value = backend.env?.[backendKey] ?? "";
      expect(value).not.toBe("");
      expect(value.length).toBeGreaterThan(0);
      if (backendKey !== "PASSKEY") {
        expect(value.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
      }
      return;
    }

    const second = loadPlaywrightConfig({ [envVarName]: "" });
    expect(second.exitCode, "rejection must be deterministic across runs").toBe(first.exitCode);
    expect(second.stderr, "failure diagnostic must be stable, not embed run-specific noise").toBe(
      first.stderr,
    );
    expect(
      first.stderr.length,
      "a bare nonzero exit with no diagnostic is not a clear rejection",
    ).toBeGreaterThan(0);
    const nameFragment = envVarName.replace("MKFD_E2E_", "");
    expect(
      first.stderr.includes(envVarName) || first.stderr.includes(nameFragment),
      `stderr must name the affected variable (${envVarName}); got: <redacted length ${first.stderr.length}>`,
    ).toBe(true);
    expect(
      /(empty|invalid|required|missing)/i.test(first.stderr),
      "stderr must describe an empty/invalid/required condition, not an arbitrary crash",
    ).toBe(true);
  }

  test("empty-string MKFD_E2E_PASSKEY override is not accepted as a valid passkey", () => {
    expectEmptyOverrideRejectedCleanly("MKFD_E2E_PASSKEY", "PASSKEY");
  });

  test("empty-string MKFD_E2E_COOKIE_SECRET override is not accepted as a valid secret", () => {
    expectEmptyOverrideRejectedCleanly("MKFD_E2E_COOKIE_SECRET", "COOKIE_SECRET");
  });

  test("empty-string MKFD_E2E_ENCRYPTION_KEY override is not accepted as a valid secret", () => {
    expectEmptyOverrideRejectedCleanly("MKFD_E2E_ENCRYPTION_KEY", "ENCRYPTION_KEY");
  });
});

// Required behavior 5 + the automatic-login compatibility invariant require
// more than "backend receives a secret" and "the fixture mentions an env
// var": the *same* value the backend received must actually be observable
// as process.env.MKFD_E2E_PASSKEY inside the process that runs Playwright's
// test files (which is what frontend/e2e/fixtures.ts reads - see the
// "authentication fixture credential sourcing" describe block below). A
// config that only ever assigns webServer.env.PASSKEY from a local variable,
// without also publishing it back onto process.env.MKFD_E2E_PASSKEY, would
// pass every test above while leaving that variable undefined for the
// fixture, silently breaking automatic login.
describe("process.env.MKFD_E2E_* published to the config-loading process (fixture availability)", () => {
  test("default (no override): process.env.MKFD_E2E_PASSKEY equals backend PASSKEY", () => {
    const { exitCode, config, publishedEnv, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(publishedEnv?.MKFD_E2E_PASSKEY?.length ?? 0).toBeGreaterThan(0);
    expect(publishedEnv?.MKFD_E2E_PASSKEY).toBe(backend.env?.PASSKEY);
  });

  test("default (no override): process.env.MKFD_E2E_COOKIE_SECRET and MKFD_E2E_ENCRYPTION_KEY equal backend values", () => {
    const { exitCode, config, publishedEnv, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect((publishedEnv?.MKFD_E2E_COOKIE_SECRET ?? "").length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect((publishedEnv?.MKFD_E2E_ENCRYPTION_KEY ?? "").length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(publishedEnv?.MKFD_E2E_COOKIE_SECRET).toBe(backend.env?.COOKIE_SECRET);
    expect(publishedEnv?.MKFD_E2E_ENCRYPTION_KEY).toBe(backend.env?.ENCRYPTION_KEY);
  });

  test("explicit MKFD_E2E_PASSKEY override (including shell metacharacters) is published identically and equals backend PASSKEY", () => {
    const { exitCode, config, publishedEnv, stderr } = loadPlaywrightConfig({ MKFD_E2E_PASSKEY: META_VALUE });
    expect(exitCode, stderr).toBe(0);
    const backend = getServerByPort(config, 5000);
    expect(publishedEnv?.MKFD_E2E_PASSKEY).toBe(META_VALUE);
    expect(publishedEnv?.MKFD_E2E_PASSKEY).toBe(backend.env?.PASSKEY);
  });
});

describe("unchanged compatibility surface", () => {
  test("baseURL and server ports remain unchanged", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    expect(config?.use?.baseURL).toBe("http://localhost:5173/public/");
    expect(() => getServerByPort(config, 5173)).not.toThrow();
    expect(() => getServerByPort(config, 5000)).not.toThrow();
  });

  test("retries/workers/reuseExistingServer are unchanged for local (no CI)", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig();
    expect(exitCode, stderr).toBe(0);
    expect(config?.retries).toBe(0);
    expect(config?.workers).toBeUndefined();
    expect(getServerByPort(config, 5173).reuseExistingServer).toBe(true);
    expect(getServerByPort(config, 5000).reuseExistingServer).toBe(true);
  });

  test("retries/workers/reuseExistingServer are unchanged for CI=true", () => {
    const { exitCode, config, stderr } = loadPlaywrightConfig({ CI: "true" });
    expect(exitCode, stderr).toBe(0);
    expect(config?.retries).toBe(2);
    expect(config?.workers).toBe(1);
    expect(getServerByPort(config, 5173).reuseExistingServer).toBe(false);
    expect(getServerByPort(config, 5000).reuseExistingServer).toBe(false);
  });
});

describe("committed credential hygiene", () => {
  const rootPackageJsonPath = join(REPO_ROOT, "package.json");
  const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const devScript = rootPackageJson.scripts?.dev ?? "";

  test("root package.json dev script contains no committed reusable passkey/cookie/encryption literal", () => {
    for (const literal of LEGACY_LITERALS) {
      expect(devScript).not.toContain(literal);
    }
  });

  test("root package.json dev script requires externally supplied credentials rather than silently supplying them", () => {
    // Generic value-agnostic patterns: reject any inline value for these
    // flags, not just the specific legacy literal, so swapping in a new
    // default (e.g. --passkey=new-default) still fails this check.
    expect(/--?passkey[= ]\S/i.test(devScript)).toBe(false);
    expect(/--?cookieSecret[= ]\S/i.test(devScript)).toBe(false);
    expect(/--?encryptionKey[= ]\S/i.test(devScript)).toBe(false);
  });

  test("root package.json dev script has no inline PASSKEY/COOKIE_SECRET/ENCRYPTION_KEY env assignment, regardless of the value used", () => {
    // Catches `PASSKEY=new-default COOKIE_SECRET=new-default ENCRYPTION_KEY=new-default bun --watch index.ts`
    // style fixes that swap the literal but keep silently supplying credentials.
    expect(/(^|\s)PASSKEY=\S+/.test(devScript)).toBe(false);
    expect(/(^|\s)COOKIE_SECRET=\S+/.test(devScript)).toBe(false);
    expect(/(^|\s)ENCRYPTION_KEY=\S+/.test(devScript)).toBe(false);
  });

  const playwrightConfigSource = readFileSync(join(FRONTEND_DIR, "playwright.config.ts"), "utf8");

  test("frontend/playwright.config.ts source contains no committed reusable passkey/cookie/encryption literal", () => {
    for (const literal of LEGACY_LITERALS) {
      expect(playwrightConfigSource).not.toContain(literal);
    }
  });
});

describe("authentication fixture credential sourcing", () => {
  const fixturesSource = readFileSync(join(FRONTEND_DIR, "e2e", "fixtures.ts"), "utf8");

  test("frontend/e2e/fixtures.ts contains no hard-coded passkey literal", () => {
    expect(fixturesSource).not.toContain("admin123");
  });

  test("frontend/e2e/fixtures.ts consumes process.env.MKFD_E2E_PASSKEY exactly - not an unrelated or differently named PASSKEY variable", () => {
    // A fixture reading process.env.PASSKEY, process.env.WRONG_PASSKEY, or any
    // other *PASSKEY-suffixed variable would satisfy a looser "some env var"
    // check while still diverging from the value actually supplied to the
    // backend via MKFD_E2E_PASSKEY (see the MKFD_E2E_* overrides describe
    // block above), silently breaking automatic login.
    expect(/process\.env\.MKFD_E2E_PASSKEY\b/.test(fixturesSource)).toBe(true);
  });

  test("frontend/e2e/fixtures.ts has no literal fallback alongside MKFD_E2E_PASSKEY", () => {
    // e.g. `process.env.MKFD_E2E_PASSKEY ?? 'admin123'` or `|| 'fallback'`
    // would still contain no bare 'admin123' literal deeper in the file and
    // would still reference the right variable name, yet would silently
    // reintroduce a hard-coded passkey whenever the env var is unset.
    const fallbackPattern = /process\.env\.MKFD_E2E_PASSKEY\s*(\?\?|\|\|)\s*['"`][^'"`]*['"`]/;
    expect(fallbackPattern.test(fixturesSource)).toBe(false);
  });

  test("frontend/e2e/fixtures.ts passes the process.env.MKFD_E2E_PASSKEY value into the passkey page.fill call", () => {
    // A mere textual mention of process.env.MKFD_E2E_PASSKEY (an unused
    // declaration, or a comment) must not be enough: the value that actually
    // reaches `page.fill` for the passkey input must be traceable back to
    // that env read - directly inline, or via a local variable assigned
    // (without a literal fallback) from it. Deliberately does not require
    // any particular helper/module layout beyond that dataflow.
    expect(fixturePasskeyFillArgumentSourcesFromEnv(fixturesSource)).toBe(true);
  });
});
