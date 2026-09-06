import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Specifies the `p2-container-hardening` requirements brief: the container
// must not run as root, credential/state directories must not be blanket
// world-readable, the build must never ship the host's `node_modules` or
// development/state directories, the base image must be pinned by digest,
// all three Compose secrets must be required with no fallback (closes
// CF-11), and the HEALTHCHECK must actually distinguish a working app from
// a broken one now that `/` redirects to `/passkey`.
//
// All assertions are text-contract checks against `dockerfile`,
// `.dockerignore` and `docker-compose.yml` - no Docker daemon is invoked.
// `tests/docker-frozen-install.test.ts` is locked under
// `p1-dependency-ci-security-baseline` and is not modified or duplicated
// here.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const dockerfileSource = readFileSync(join(REPO_ROOT, "dockerfile"), "utf8");
const dockerignoreSource = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8");
const composeSource = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Instruction = { instruction: string; args: string };

/** Parses top-level Dockerfile instructions in file order. Joins `\` line continuations, skips blank lines and comments. */
function parseDockerfileInstructions(text: string): Instruction[] {
  const joined = text.replace(/\\\r?\n/g, " ");
  const lines = joined.split(/\r?\n/);
  const instructions: Instruction[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z]+)\s+(.*)$/.exec(trimmed);
    if (!match) continue;
    instructions.push({ instruction: match[1].toUpperCase(), args: match[2].trim() });
  }
  return instructions;
}

function lastIndexOf(instructions: Instruction[], name: string): number {
  let found = -1;
  instructions.forEach((instr, idx) => {
    if (instr.instruction === name) found = idx;
  });
  return found;
}

function firstIndexMatching(instructions: Instruction[], name: string, argsPattern: RegExp): number {
  return instructions.findIndex((instr) => instr.instruction === name && argsPattern.test(instr.args));
}

/** True if a Dockerfile USER argument (e.g. "bun", "bun:bun", "0", "root:root") resolves to root. */
function isRootUser(userArg: string | undefined): boolean {
  if (!userArg) return true;
  const name = userArg.split(":")[0].trim();
  return name === "root" || name === "0";
}

/** Extracts every `chown [user] [paths...]` invocation from a shell script body (a RUN instruction's args). */
function extractChownCommands(shellText: string): { user: string; paths: string[] }[] {
  const commands: { user: string; paths: string[] }[] = [];
  const re = /chown\s+(?:-R\s+)?(\S+)\s+([^&;\n]+)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec-loop idiom
  while ((match = re.exec(shellText)) !== null) {
    const paths = match[2]
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== "\\");
    commands.push({ user: match[1], paths });
  }
  return commands;
}

/** Extracts every `chmod [mode] [paths...]` invocation's octal mode and target paths from a shell script body. */
function extractChmodCommands(shellText: string): { recursive: boolean; mode: string; paths: string[] }[] {
  const commands: { recursive: boolean; mode: string; paths: string[] }[] = [];
  const re = /chmod\s+(-R\s+)?([0-7]{3,4})\s+([^&;\n]+)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec-loop idiom
  while ((match = re.exec(shellText)) !== null) {
    const paths = match[3]
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== "\\");
    commands.push({ recursive: Boolean(match[1]), mode: match[2], paths });
  }
  return commands;
}

/** True if an octal permission mode grants any bit (read/write/execute) to group or other. */
function modeGrantsGroupOrOther(mode: string): boolean {
  const digits = mode.length === 4 ? mode.slice(1) : mode;
  const group = Number.parseInt(digits[1] ?? "0", 8);
  const other = Number.parseInt(digits[2] ?? "0", 8);
  return group !== 0 || other !== 0;
}

/** Tokenizes a shell/CMD-array command string into curl's short (bundled) and long flag names, e.g. "-fsSL" -> f,s,S,L and "--fail" -> "fail". */
function curlFlags(cmdText: string): Set<string> {
  const flags = new Set<string>();
  for (const token of cmdText.split(/\s+/)) {
    if (token.startsWith("--")) {
      flags.add(token.slice(2));
    } else if (token.startsWith("-") && token.length > 1) {
      for (const ch of token.slice(1)) flags.add(ch);
    }
  }
  return flags;
}

function curlFailsOnHttpError(flags: Set<string>): boolean {
  return flags.has("f") || flags.has("fail");
}

function curlFollowsRedirects(flags: Set<string>): boolean {
  return flags.has("L") || flags.has("location");
}

/** Escapes one glob segment (no longer containing `**`) so it is safe to embed in a RegExp; a lone `*` still becomes `[^/]*`. */
function escapeGlobSegment(segment: string): string {
  return segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
}

/** Converts one `.dockerignore` line into a RegExp matching relative POSIX paths, following the same anchoring rules Docker/`.gitignore` use: a pattern containing "/" (other than a single trailing slash) is anchored to the build context root; a bare segment matches at any depth. Splits on the literal `**` globstar and rejoins with `.*` rather than using a sentinel character, so no control character ever reaches a regex. */
function dockerignorePatternToRegExp(pattern: string): RegExp {
  let p = pattern;
  if (p.startsWith("/")) p = p.slice(1);
  const trailingSlash = p.endsWith("/");
  if (trailingSlash) p = p.slice(0, -1);
  const anchored = pattern.startsWith("/") || p.includes("/");
  const body = p.split("**").map(escapeGlobSegment).join(".*");
  const anchoredBody = anchored ? `^${body}` : `(^|.*/)${body}`;
  return new RegExp(anchoredBody + (trailingSlash ? "(/.*)?$" : "($|/.*)"));
}

function dockerignoreExcludes(dockerignoreText: string, relativePath: string): boolean {
  const lines = dockerignoreText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("!"));
  return lines.some((line) => dockerignorePatternToRegExp(line).test(relativePath));
}

/** Extracts the single-line value assigned to `key:` inside a YAML-array-of-strings like `test: ["CMD", "curl", "-f", "url"]`. */
function extractYamlInlineArray(yamlText: string, key: string): string[] | undefined {
  const re = new RegExp(`${key}:\\s*(\\[[^\\]]*\\])`);
  const match = re.exec(yamlText);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1].replace(/'/g, '"'));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helper correctness
// ---------------------------------------------------------------------------

describe("parseDockerfileInstructions helper correctness", () => {
  test("extracts simple instructions in order", () => {
    const text = "FROM x\nRUN a\nUSER bun\nCMD b\n";
    expect(parseDockerfileInstructions(text).map((i) => i.instruction)).toEqual(["FROM", "RUN", "USER", "CMD"]);
  });

  test("joins a backslash line-continued RUN instruction into one instruction", () => {
    const text = "RUN mkdir -p /app/x \\\n && chown bun /app/x\n";
    const instrs = parseDockerfileInstructions(text);
    expect(instrs.length).toBe(1);
    expect(instrs[0].args).toContain("chown bun /app/x");
  });

  test("skips blank lines and comment lines", () => {
    const text = "# a comment\nFROM x\n\n# another\nUSER bun\n";
    expect(parseDockerfileInstructions(text).map((i) => i.instruction)).toEqual(["FROM", "USER"]);
  });

  test("is case-insensitive on the instruction keyword", () => {
    expect(parseDockerfileInstructions("user bun\n")[0].instruction).toBe("USER");
  });

  test("lastIndexOf returns the final matching instruction's position, or -1 when absent", () => {
    const instrs = parseDockerfileInstructions("USER root\nRUN a\nUSER bun\n");
    expect(lastIndexOf(instrs, "USER")).toBe(2);
    expect(lastIndexOf(instrs, "ENTRYPOINT")).toBe(-1);
  });

  test("firstIndexMatching filters by both instruction name and an args pattern", () => {
    const instrs = parseDockerfileInstructions("RUN echo hi\nRUN apt-get install -y curl\n");
    expect(firstIndexMatching(instrs, "RUN", /apt-get install/)).toBe(1);
    expect(firstIndexMatching(instrs, "RUN", /nonexistent/)).toBe(-1);
  });
});

describe("isRootUser helper correctness", () => {
  test("treats a missing USER as root", () => {
    expect(isRootUser(undefined)).toBe(true);
  });
  test("treats literal 'root' and uid '0' as root, with or without a group suffix", () => {
    expect(isRootUser("root")).toBe(true);
    expect(isRootUser("root:root")).toBe(true);
    expect(isRootUser("0")).toBe(true);
    expect(isRootUser("0:0")).toBe(true);
  });
  test("treats a named non-root user as non-root, with or without a group suffix", () => {
    expect(isRootUser("bun")).toBe(false);
    expect(isRootUser("bun:bun")).toBe(false);
  });
});

describe("extractChownCommands / extractChmodCommands helper correctness", () => {
  test("extracts a chown user and its multiple target paths", () => {
    const commands = extractChownCommands("mkdir -p /app/configs /app/data && chown -R bun:bun /app/configs /app/data");
    expect(commands).toEqual([{ user: "bun:bun", paths: ["/app/configs", "/app/data"] }]);
  });

  test("extracts a chmod mode, recursion flag, and target paths", () => {
    const commands = extractChmodCommands("chmod -R 755 /app/configs /app/extensions");
    expect(commands).toEqual([{ recursive: true, mode: "755", paths: ["/app/configs", "/app/extensions"] }]);
  });

  test("returns an empty array when there is no chown/chmod in the text", () => {
    expect(extractChownCommands("mkdir -p /app/configs")).toEqual([]);
    expect(extractChmodCommands("mkdir -p /app/configs")).toEqual([]);
  });
});

describe("modeGrantsGroupOrOther helper correctness", () => {
  test("755 grants group and other read+execute", () => {
    expect(modeGrantsGroupOrOther("755")).toBe(true);
  });
  test("700 grants nothing to group or other", () => {
    expect(modeGrantsGroupOrOther("700")).toBe(false);
  });
  test("710 (group execute only) still counts as granting group access", () => {
    expect(modeGrantsGroupOrOther("710")).toBe(true);
  });
  test("handles a leading sticky/setuid digit (4-digit mode)", () => {
    expect(modeGrantsGroupOrOther("0700")).toBe(false);
    expect(modeGrantsGroupOrOther("0755")).toBe(true);
  });
});

describe("curlFlags / curlFailsOnHttpError / curlFollowsRedirects helper correctness", () => {
  test("reads bundled short flags", () => {
    const flags = curlFlags("curl -fsSL http://x/");
    expect(curlFailsOnHttpError(flags)).toBe(true);
    expect(curlFollowsRedirects(flags)).toBe(true);
  });
  test("reads long-form flags", () => {
    const flags = curlFlags("curl --fail --location http://x/");
    expect(curlFailsOnHttpError(flags)).toBe(true);
    expect(curlFollowsRedirects(flags)).toBe(true);
  });
  test("a bare '-f' with no location flag fails on error but does not follow redirects", () => {
    const flags = curlFlags("curl -f http://x/");
    expect(curlFailsOnHttpError(flags)).toBe(true);
    expect(curlFollowsRedirects(flags)).toBe(false);
  });
  test("no flags at all means neither behavior is present", () => {
    const flags = curlFlags("curl http://x/");
    expect(curlFailsOnHttpError(flags)).toBe(false);
    expect(curlFollowsRedirects(flags)).toBe(false);
  });
});

describe("dockerignorePatternToRegExp / dockerignoreExcludes helper correctness", () => {
  test("a bare pattern (no slash) matches that path segment at any depth", () => {
    expect(dockerignoreExcludes("node_modules\n", "node_modules")).toBe(true);
    expect(dockerignoreExcludes("node_modules\n", "frontend/node_modules")).toBe(true);
    expect(dockerignoreExcludes("node_modules\n", "node_modules/.cache/x.json")).toBe(true);
  });
  test("a slash-containing pattern is anchored to the build context root", () => {
    expect(dockerignoreExcludes("frontend/node_modules\n", "frontend/node_modules")).toBe(true);
    expect(dockerignoreExcludes("frontend/node_modules\n", "node_modules")).toBe(false);
    expect(dockerignoreExcludes("frontend/node_modules\n", "other/frontend/node_modules")).toBe(false);
  });
  test("a trailing-slash pattern only matches the directory's contents, and comment/negation lines are ignored", () => {
    expect(dockerignoreExcludes("feed-state/\n", "feed-state/x.json")).toBe(true);
    expect(dockerignoreExcludes("# feed-state/\n", "feed-state/x.json")).toBe(false);
    expect(dockerignoreExcludes("!feed-state/\n", "feed-state/x.json")).toBe(false);
  });
  test("an unrelated path is not excluded", () => {
    expect(dockerignoreExcludes("node_modules\n", "index.ts")).toBe(false);
  });
});

describe("extractYamlInlineArray helper correctness", () => {
  test("parses a double-quoted inline array", () => {
    expect(extractYamlInlineArray('test: ["CMD", "curl", "-f", "http://x/"]', "test")).toEqual([
      "CMD",
      "curl",
      "-f",
      "http://x/",
    ]);
  });
  test("returns undefined when the key is absent", () => {
    expect(extractYamlInlineArray("other: 1", "test")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Requirement 1: the container does not run as root
// ---------------------------------------------------------------------------

describe("requirement 1: the dockerfile selects a non-root USER, effectively", () => {
  const instructions = parseDockerfileInstructions(dockerfileSource);
  const userIndices: number[] = [];
  instructions.forEach((i, idx) => {
    if (i.instruction === "USER") userIndices.push(idx);
  });

  test("declares at least one USER instruction", () => {
    expect(userIndices.length).toBeGreaterThan(0);
  });

  test("the final USER instruction in the file does not select root or uid 0", () => {
    const lastUserIdx = lastIndexOf(instructions, "USER");
    expect(lastUserIdx, "expected a USER instruction to exist").toBeGreaterThanOrEqual(0);
    expect(isRootUser(instructions[lastUserIdx].args)).toBe(false);
  });

  test("the final USER instruction takes effect before CMD runs (no re-escalation after it)", () => {
    const lastUserIdx = lastIndexOf(instructions, "USER");
    const cmdIdx = lastIndexOf(instructions, "CMD");
    expect(lastUserIdx, "expected a USER instruction to exist").toBeGreaterThanOrEqual(0);
    expect(cmdIdx, "expected a CMD instruction to exist").toBeGreaterThanOrEqual(0);
    expect(lastUserIdx).toBeLessThan(cmdIdx);
  });

  test("no ENTRYPOINT or CMD instruction re-escalates privileges via sudo/gosu/su/setuid", () => {
    const privilegeEscalators = /\b(sudo|gosu|setuid)\b|\bsu\s+-/;
    for (const instr of instructions) {
      if (instr.instruction === "ENTRYPOINT" || instr.instruction === "CMD") {
        expect(privilegeEscalators.test(instr.args)).toBe(false);
      }
    }
  });

  test("privileged setup (apt-get install, the Node.js download, and creating /app/configs, /app/extensions, and the data directory) happens before the USER switch, not after", () => {
    const lastUserIdx = lastIndexOf(instructions, "USER");
    expect(lastUserIdx, "expected a USER instruction to exist").toBeGreaterThanOrEqual(0);

    const aptInstallIdx = firstIndexMatching(instructions, "RUN", /apt-get\s+install/);
    const nodeInstallIdx = firstIndexMatching(instructions, "RUN", /nodejs\.org|NODE_VERSION/);
    const dirSetupIdx = firstIndexMatching(instructions, "RUN", /\/app\/configs/);

    expect(aptInstallIdx, "expected an apt-get install RUN instruction").toBeGreaterThanOrEqual(0);
    expect(nodeInstallIdx, "expected the Node.js download RUN instruction").toBeGreaterThanOrEqual(0);
    expect(dirSetupIdx, "expected a RUN instruction that sets up /app/configs").toBeGreaterThanOrEqual(0);

    expect(aptInstallIdx).toBeLessThan(lastUserIdx);
    expect(nodeInstallIdx).toBeLessThan(lastUserIdx);
    expect(dirSetupIdx).toBeLessThan(lastUserIdx);
  });

  test("the non-root user does not own the whole application tree or filesystem root (no bare 'chown -R <user> /app' or '/')", () => {
    for (const instr of instructions) {
      if (instr.instruction !== "RUN") continue;
      for (const cmd of extractChownCommands(instr.args)) {
        for (const path of cmd.paths) {
          expect(["/app", "/"]).not.toContain(path);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 2: app-writable directories are owned by the non-root user,
// not world-writable/readable via a blanket recursive chmod
// ---------------------------------------------------------------------------

describe("requirement 2: /app/configs, /app/extensions and the runtime data directory use ownership, not a blanket permissive mode", () => {
  const instructions = parseDockerfileInstructions(dockerfileSource);
  const runBodies = instructions.filter((i) => i.instruction === "RUN").map((i) => i.args);
  const fullShellText = runBodies.join(" && ");

  test("no RUN instruction recursively chmods /app/configs, /app/extensions, or the data directory to a mode that grants group or other any access", () => {
    for (const body of runBodies) {
      for (const cmd of extractChmodCommands(body)) {
        const targetsAppDir = cmd.paths.some((p) => /\/app\/(configs|extensions|data)\b/.test(p));
        if (!targetsAppDir) continue;
        expect(
          modeGrantsGroupOrOther(cmd.mode),
          `chmod ${cmd.recursive ? "-R " : ""}${cmd.mode} on ${cmd.paths.join(" ")} grants group/other access`,
        ).toBe(false);
      }
    }
  });

  test("specifically, the known-bad 'chmod -R 755' on the credential/extension/data directories is absent", () => {
    expect(fullShellText).not.toMatch(/chmod\s+-R\s+755\s+[^\n]*\/app\/(configs|extensions|data)\b/);
  });

  test("a chown to a non-root user covers /app/configs, /app/extensions and the runtime data directory", () => {
    const lastUserIdx = lastIndexOf(instructions, "USER");
    const declaredUser = lastUserIdx >= 0 ? instructions[lastUserIdx].args : undefined;

    const chownedPaths = new Set<string>();
    let sawNonRootChownUser = false;
    for (const body of runBodies) {
      for (const cmd of extractChownCommands(body)) {
        if (!isRootUser(cmd.user)) sawNonRootChownUser = true;
        for (const p of cmd.paths) chownedPaths.add(p);
      }
    }

    expect(sawNonRootChownUser, "expected at least one chown to a non-root user").toBe(true);
    expect([...chownedPaths].some((p) => p === "/app/configs" || p.startsWith("/app/configs/"))).toBe(true);
    expect([...chownedPaths].some((p) => p === "/app/extensions" || p.startsWith("/app/extensions/"))).toBe(true);
    expect([...chownedPaths].some((p) => p === "/app/data" || p.startsWith("/app/data/"))).toBe(true);

    if (declaredUser) {
      const declaredName = declaredUser.split(":")[0];
      const chownedToDeclaredUser = runBodies.some((body) =>
        extractChownCommands(body).some((cmd) => cmd.user.split(":")[0] === declaredName),
      );
      const message = `expected a chown targeting the same user ("${declaredName}") later selected by USER`;
      expect(chownedToDeclaredUser, message).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 3 & 4: .dockerignore excludes the root node_modules outright,
// and development/state directories
// ---------------------------------------------------------------------------

describe("requirement 3: .dockerignore excludes the root node_modules tree outright", () => {
  test("a bare 'node_modules' entry (or equivalent) excludes the root dependency tree", () => {
    expect(dockerignoreExcludes(dockerignoreSource, "node_modules")).toBe(true);
  });

  test("that exclusion is not merely scoped to a subdirectory (regression: frontend/node_modules stays excluded too)", () => {
    expect(dockerignoreExcludes(dockerignoreSource, "frontend/node_modules")).toBe(true);
  });
});

describe("requirement 4: .dockerignore excludes development and runtime state directories", () => {
  test.each(["feed-state", "tests", ".tdd-state"])("excludes %s and its contents", (dir) => {
    expect(dockerignoreExcludes(dockerignoreSource, dir)).toBe(true);
    expect(dockerignoreExcludes(dockerignoreSource, `${dir}/some-file.json`)).toBe(true);
  });

  test.each([".git", ".env", "configs", "public/feeds", "dist", "build"])(
    "regression: previously-excluded %s stays excluded",
    (path) => {
      expect(dockerignoreExcludes(dockerignoreSource, path)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Requirement 5: the base image is pinned by digest
// ---------------------------------------------------------------------------

describe("requirement 5: the base image is pinned by digest with a re-verifiable provenance comment", () => {
  const instructions = parseDockerfileInstructions(dockerfileSource);

  test("the FROM instruction carries an @sha256:<64 hex chars> digest", () => {
    const fromInstr = instructions.find((i) => i.instruction === "FROM");
    expect(fromInstr, "expected a FROM instruction").toBeDefined();
    expect(fromInstr?.args).toMatch(/^oven\/bun:\S+@sha256:[0-9a-f]{64}/);
  });

  test("a nearby comment records how the digest was obtained, so it can be re-verified", () => {
    const lines = dockerfileSource.split(/\r?\n/);
    const fromLineIdx = lines.findIndex((l) => /^\s*FROM\s+/.test(l));
    expect(fromLineIdx, "expected to find the FROM line").toBeGreaterThanOrEqual(0);

    const nearby = lines.slice(Math.max(0, fromLineIdx - 3), fromLineIdx + 1).join("\n");
    const mentionsDigest = /#.*digest/i.test(nearby);
    const givesReverificationHint = /#.*(docker|regctl|skopeo|crane|buildx|\d{4}-\d{2}-\d{2})/i.test(nearby);
    expect(mentionsDigest, "expected a comment near FROM mentioning the digest").toBe(true);
    expect(
      givesReverificationHint,
      "expected the provenance comment to include how/when to re-verify (a command or a date)",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement 6 (CF-11): Compose refuses to start without PASSKEY,
// COOKIE_SECRET and ENCRYPTION_KEY - symmetric coverage for all three
// ---------------------------------------------------------------------------

describe("requirement 6 / CF-11: docker-compose.yml requires PASSKEY, COOKIE_SECRET and ENCRYPTION_KEY with no fallback", () => {
  test.each(["PASSKEY", "COOKIE_SECRET", "ENCRYPTION_KEY"])(
    "%s uses Compose's :? required-variable form with a non-empty message, and has no shell-default fallback",
    (varName) => {
      const requiredPattern = new RegExp(`\\$\\{${varName}:\\?([^}]*)\\}`);
      const match = requiredPattern.exec(composeSource);
      const notFoundMessage = `expected a :? required-variable form for ${varName} in docker-compose.yml`;
      expect(match, notFoundMessage).not.toBeNull();
      expect((match?.[1] ?? "").trim().length).toBeGreaterThan(0);

      const fallbackPattern = new RegExp(`\\$\\{${varName}:-`);
      expect(fallbackPattern.test(composeSource)).toBe(false);
    },
  );

  test.each(["PASSKEY", "COOKIE_SECRET", "ENCRYPTION_KEY"])(
    "every assignment of %s= in the file uses the :?... required-variable form (no hardcoded literal default anywhere)",
    (varName) => {
      const assignmentPattern = new RegExp(`\\b${varName}=(\\S*)`, "g");
      const assignments = [...composeSource.matchAll(assignmentPattern)].map((m) => m[1]);
      expect(assignments.length).toBeGreaterThan(0);
      for (const value of assignments) {
        expect(value.startsWith(`\${${varName}:?`)).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Requirement 7: the HEALTHCHECK distinguishes a working app from a broken
// one now that `/` redirects to `/passkey`
// ---------------------------------------------------------------------------

describe("requirement 7: the HEALTHCHECK follows the auth redirect to a real status instead of trusting the 302 itself", () => {
  test("the dockerfile HEALTHCHECK's curl both fails on HTTP errors and follows redirects", () => {
    const healthcheckMatch = /HEALTHCHECK\b[\s\S]*?CMD\s+([^\n]*?)(?:\s*\|\|[^\n]*)?$/m.exec(
      dockerfileSource.replace(/\\\r?\n/g, " "),
    );
    expect(healthcheckMatch, "expected a HEALTHCHECK ... CMD instruction").not.toBeNull();
    const cmdText = healthcheckMatch?.[1] ?? "";
    expect(cmdText).toContain("curl");

    const flags = curlFlags(cmdText);
    expect(curlFailsOnHttpError(flags), "expected curl to fail on HTTP error responses (-f/--fail)").toBe(true);
    expect(
      curlFollowsRedirects(flags),
      "expected curl to follow the 302 to /passkey (-L/--location) so a broken app behind the redirect is caught, not masked by the redirect status alone",
    ).toBe(true);
  });

  test("docker-compose.yml's healthcheck test uses the same fail-and-follow curl contract", () => {
    const testArray = extractYamlInlineArray(composeSource, "test");
    expect(testArray, "expected a healthcheck.test inline array in docker-compose.yml").toBeDefined();
    expect(testArray?.[0]).toBe("CMD");
    expect(testArray?.[1]).toBe("curl");

    const flags = curlFlags((testArray ?? []).slice(2).join(" "));
    expect(curlFailsOnHttpError(flags)).toBe(true);
    expect(curlFollowsRedirects(flags)).toBe(true);
  });
});
