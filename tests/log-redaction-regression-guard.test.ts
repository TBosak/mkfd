// tests/log-redaction-regression-guard.test.ts
//
// Requirement 8 of slice p2-redacting-logger: a regression guard that stops
// the two known-dangerous logging patterns from reappearing in the exact
// files this slice touches.
//
// Honesty about scope, per the brief: a static scan over source text cannot
// prove the absence of secret leaks in general. This guard only catches:
//   - the two specific identifiers named in the brief (`axiosConfig` in
//     preview-generator.utility.ts, `encryptionKey` in imap-feed.worker.ts)
//     being passed to a `console.*` call without also passing through
//     something calling `redact(`;
//   - the diagnostic being deleted outright rather than redacted.
//
// It will NOT catch: the same secret flowing through a differently-named
// variable, a leak introduced in a different file, a `redact(` call that
// exists syntactically but is a no-op, or a leak reached through
// destructuring/renaming (e.g. `const { encryptionKey: k } = msg.data`).
// That is the honest limit of a text-level check; it is not a substitute
// for the behavioral tests in tests/log-redaction-call-sites.test.ts, which
// this file complements rather than replaces.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

// Extracts the text of every `console.<method>(...)` statement, matched up
// to its first closing `);`. Good enough for the single-line call sites
// this guard is scoped to; it does not need to handle arbitrary nested
// parens because neither known call site (nor any conforming fix) requires
// them between `console.x(` and its terminating `);`.
function consoleStatements(source: string): string[] {
  const matches = source.matchAll(/console\.(?:log|error|warn|info)\([\s\S]*?\);/g);
  return Array.from(matches, (m) => m[0]);
}

describe("regression guard: preview-generator.utility.ts must not log raw axiosConfig (req 8)", () => {
  const source = readSource("utilities/preview-generator.utility.ts");
  const statements = consoleStatements(source);
  const axiosConfigStatements = statements.filter((s) => /\baxiosConfig\b/.test(s));

  it("logs axiosConfig at least once (the diagnostic this guard protects still exists)", () => {
    expect(axiosConfigStatements.length).toBeGreaterThan(0);
  });

  it("never passes the raw axiosConfig object to console.* unredacted", () => {
    const unredacted = axiosConfigStatements.filter((s) => !s.includes("redact("));
    expect(unredacted).toEqual([]);
  });

  it("keeps the diagnostic — the redacted call site is not simply deleted", () => {
    const redactedButPresent = axiosConfigStatements.filter((s) => s.includes("redact("));
    expect(redactedButPresent.length).toBeGreaterThan(0);
  });
});

describe("regression guard: imap-feed.worker.ts must not log the raw encryptionKey (req 8)", () => {
  const source = readSource("workers/imap-feed.worker.ts");
  const statements = consoleStatements(source);
  const encryptionKeyStatements = statements.filter((s) => /\bencryptionKey\b/.test(s));

  it("logs something about the encryption key at least once (the diagnostic still exists)", () => {
    expect(encryptionKeyStatements.length).toBeGreaterThan(0);
  });

  it("never passes the raw encryptionKey value to console.* unredacted", () => {
    const unredacted = encryptionKeyStatements.filter((s) => !s.includes("redact("));
    expect(unredacted).toEqual([]);
  });

  it("keeps the diagnostic naming the failure — the call site is not simply deleted", () => {
    const stillNamesTheFailure = statements.some((s) => /invalid encryption key/i.test(s));
    expect(stillNamesTheFailure).toBe(true);
  });
});
