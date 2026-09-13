# Tooling and Retrieval Rules

These rules apply to Claude Code and OpenAI Codex equally. This file is
canonical: it lives in `.ruler/` and is propagated into `AGENTS.md` and
`CLAUDE.md`. **Do not edit the generated files — edit `.ruler/` and run
`bun run agents:apply`.**

## Working-tree safety (non-negotiable)

- Never run `git reset`, `git clean`, `git checkout --`, `git restore`,
  `git stash`, force checkout, or history rewriting without an explicit
  instruction naming that command. The working tree is frequently dirty with
  work in progress that is not recoverable from Git.
- Never commit unless asked.
- Never upgrade unrelated dependencies or reformat files a task does not touch.
- Never weaken, delete, skip, or re-baseline an existing test to make a tool or
  a gate pass.

## Tool ownership — deliberately non-overlapping

| Concern | Canonical tool |
|---|---|
| Cross-provider agent instructions and shared MCP | Ruler (`.ruler/`) |
| Durable task continuity across a session/provider boundary | Beads (`bd`) |
| Durable prose/decision retrieval (Markdown, ADRs, specs) | QMD |
| Repository/code topology, blast radius | Graphify |
| Symbol navigation and symbol-level edits | Serena (MCP) |
| External library/framework documentation | Context7 |
| Formatting and linting | Biome |
| Structural health: dead code, cycles, duplication, boundaries | Fallow |
| Project-specific AST invariants | ast-grep |
| Test strength | StrykerJS |
| Security code patterns | Semgrep |
| Dependency vulnerabilities | OSV-Scanner |
| Secrets | Gitleaks |

Do not add another retrieval or indexing tool without a demonstrated gap.

## Retrieval rules — spend the smallest tool that answers the question

1. **Do not read a whole file** when Serena can retrieve the symbol.
2. **Do not grep the repo to rebuild a dependency or call graph** when Graphify
   already answers it.
3. **Do not open many docs** when QMD can locate the section.
4. Do not ask QMD about symbol references, and do not ask Graphify about prose
   decisions. They are not interchangeable.
5. Do not ask Context7 about Mkfd's own behaviour — that is QMD/Graphify/Serena.
6. Prefer deterministic CLI evidence over model recall. If a command can prove
   it, run the command.
7. Refresh indexes on meaningful change (moved files, new modules, refactors,
   doc rewrites), not after every edit.

### Which tool for which question

| Question | Tool | Command |
|---|---|---|
| "Why does this work this way?" / "What did we decide?" | QMD | `qmd search "<keywords>"` first; `qmd query "<question>"` when wording is uncertain |
| "What breaks if I change this?" / "What calls this?" | Graphify | `graphify affected "<symbol>" --depth 2` |
| "What are the architectural hubs?" | Graphify | `graphify god-nodes --top 10` |
| "Where is this symbol, and what references it?" | Serena | MCP tools (Docker gateway, AI coding profile) |
| "What is the current API of Hono/Bun/Playwright?" | Context7 | MCP tools (Docker gateway, AI coding profile) |
| "Is this dead code? Are there cycles?" | Fallow | `bun run check:structural`, or `bun x fallow audit --base <ref>` for changed files only |
| "Does this violate an Mkfd invariant?" | ast-grep | `bun run check:invariants` |

QMD is indexed over `docs/` only (169 files, collection `mkfd-docs`). It knows
nothing about the TypeScript source by design — that is Graphify and Serena.
Re-run `qmd collection add docs --name mkfd-docs && qmd embed` after meaningful
documentation changes; re-run `graphify update . --no-cluster` after structural
code changes (moved files, new modules, renamed symbols), not after every edit.

### MCP is managed by the Docker MCP gateway

Serena, Context7, Playwright, GitHub, ast-grep and the rest are registered in
the Docker MCP gateway under the **AI coding** profile — not as standalone
per-project stdio servers, and not in `.mcp.json` (which is deliberately empty).
Inspect with `docker mcp profile server ls`. Serena runs containerised with this
repository mounted at `/workspaces/projects/mkfd`.

## Beads — durable continuity only

Beads exists **only** to carry compact state across a session or provider
boundary. It is not a message bus and not a work log.

Use a Bead when work will cross a Claude↔Codex switch, must pause and resume,
has blockers worth retaining outside chat history, or produced a durable
discovery that creates follow-up work.

A Bead holds: stable acceptance criteria (or a pointer to them), blockers,
accepted architectural discoveries, high-level status, whether the test contract
is accepted, relevant gate status, unresolved work, and the exact next action.

**Beads must never mediate the implementer↔tester exchange.** Specifically:

- The test author is never required to read, create, update, or close a Bead.
- Never copy tester responses, line-level coverage evidence, RED/GREEN
  iterations, rejected tests, or review dialogue into Beads.
- Never create a Bead per TDD round, per mutant, or per test file.
- Never make a Bead a prerequisite for running tests or gates.
- Update Beads at durable state boundaries, not conversational ones.

A durable summary such as `URL resolution contract covered; tests accepted;
implementation green; mutation review pending` is sufficient. Use
`bd remember` only for discoveries likely to matter again.

Beads does not replace ADRs, architecture docs, or test evidence. Design
knowledge belongs in Markdown (and therefore QMD); immediate test evidence
belongs in the direct tester response; resumable execution state belongs in
Beads.

## Deterministic gates

Run the sequence appropriate to the changed scope. Canonical commands:

| Command | Covers | Currently clean? |
|---|---|---|
| `bun run check:fast` | Biome + typecheck (`verify:static`) | yes |
| `bun run check:invariants` | ast-grep Mkfd invariants | **no — 2 known violations** |
| `bun run check:structural` | Fallow full-repo analysis | **no — 69 legacy findings** |
| `bun run check:security` | Semgrep local rules + OSV + Gitleaks | Semgrep/Gitleaks clean; OSV reports 5 |
| `bun run test` | Normal test suite | **no — 32 known failures** |
| `bun run verify:core` | Static + tests + catalog + build | no (inherits the 32) |
| `bun run verify:full` | `verify:core` + Playwright e2e | e2e itself is green |
| `bun run test:mutation` | Targeted Stryker scope | baseline 44.71% |
| `bun run agents:apply` | Regenerate `AGENTS.md`/`CLAUDE.md` from `.ruler/` | yes |
| `bun run agents:check` | Fail if generated agent files drift from `.ruler/` | yes |

**Several gates are knowingly red on pre-existing findings.** Compare against
the baseline recorded in `docs/mkfd-v3-implementation-ledger.md`, never against
"zero failures", and do not attribute a pre-existing failure to your own change
without checking. The red gates are not wired into hooks or CI as blocking
precisely because a gate that always fails stops being read.

After a behavioural change to deterministic core logic, run targeted Stryker.
A surviving mutant is triage input, not an automatic requirement for another
test. If a mutant reveals a real gap, send the test author a new concise rule
through the existing protocol — do not record the mutation round in Beads.

Note that Stryker runs through the **command runner**, so it re-runs the whole
configured suite per mutant and has no per-test selectivity. The Bun-specific
runner was trialled and rejected (it mangles the Windows project path); see
`stryker.config.json`.

## Skills ownership

`.agents/skills/` plus `skills-lock.json` is the committed, tamper-evident
source for third-party skills, installed via `npx skills add` /
`npx impeccable install`. Ruler does **not** manage skills in this repository
(`--skills=false`) precisely so it cannot fight that system. Ruler owns the
generated instruction files and the shared MCP declaration, nothing else.
