# TDD Requirements Brief: `p3-filesystem-runtime-controls`

## Ownership

- Roadmap packet and finding IDs: Packet 3 resource-control platform, Packet 7B
  filesystem substrate prerequisite, audit S6 and filesystem portions of S9.
- Feature spec and plan: `docs/superpowers/specs/2026-09-11-filesystem-runtime-controls-design.md`,
  `docs/superpowers/plans/2026-09-11-filesystem-runtime-controls.md`, the approved
  Runtime Resource Controls Slice 5, and `docs/features/Filesystem Feed Implementation Plan.md`.
- Production surfaces: filesystem model/scanner/config validation and existing
  preview/worker dispatch, plus managed runtime SQLite schema/migration/store.
- Test surface: Luna may add `tests/p3-filesystem-runtime-controls.test.ts` and
  may revise an existing filesystem assertion only when the old assertion
  directly requires superseded JSON state. Luna must not edit production,
  configuration, migrations, documentation, or lock files.

## Required observable behavior

| ID | Required observable behavior |
|---|---|
| A1 | Saving and running a filesystem config authorize an existing canonical scan directory under one canonical deployment root. Lexical siblings, `..`, nonexistent roots, files, and canonical targets outside every approved root are rejected with sanitized errors. |
| A2 | Scans never follow symlinks or junctions. Every directory and opened file remains under the authorized canonical root; a deterministic path swap between discovery and open fails closed without reading escaped bytes. |
| A3 | One scan enforces hard ceilings of depth 32, 10,000 visited entries, 10,000 matches, 64 MiB total bytes read, and 30,000 ms elapsed time. Exact limits are allowed; the first excess unit aborts deterministically. |
| A4 | Sidecars are at most 64 KiB, depth 8, and 1,024 contained keys/elements, must be JSON objects, and reject prototype-mutation keys before use. Malformed or over-limit sidecars are skipped with a sanitized warning and never read beyond the ceiling; valid neighboring files still scan, preserving the existing best-effort sidecar contract. |
| A5 | A content-hash or extraction read is at most 5 MiB and extraction output is at most 20,000 characters. Configured lower limits apply; larger/nonpositive/fractional/nonfinite settings cannot create an unbounded read. Unsupported extensions are not read for extraction. |
| A6 | `maxItems` accepts positive integers and clamps at 10,000. Include/exclude each accept at most 100 non-empty strings of at most 256 UTF-8 bytes. Empty include still means all files, exclude wins, and invalid types/values fail before traversal. |
| A7 | Traversal-limit, authorization, race, cancellation, and unsafe I/O failures return/throw stable typed codes and safe counters only, with no submitted path, host path, sidecar content, raw filesystem message, or stack in a client-visible result. Recoverable sidecar skips use sanitized warning codes under A4. |
| A8 | The managed SQLite schema stores one row per `(feed_id, relative_path)` with stable ID, first/last seen, last modified, size, and optional content hash, plus an index supporting feed-scoped state reads. |
| A9 | A successful complete scan commits all observations and disappearance cleanup in one transaction. Any failed/cancelled scan commits none of its state changes. Concurrent scans cannot lose first-seen identity or expose a half-complete state. |
| A10 | State reads survive closing/reopening a real SQLite file; `firstSeenAt` and `firstSeenId` remain stable across later scans while last-seen/file metadata update only after a complete scan. |
| A11 | On first use, valid `feed-state/filesystem/<safe-feed-id>.json` records copy forward idempotently into SQLite, malformed/unsafe records are skipped without losing valid neighbors, SQLite wins conflicts, and source files remain unchanged/recoverable. |
| A12 | Existing item mapping remains compatible: normalized `/` relative paths, include/exclude glob semantics, sort/date/GUID/title/description strategies, public URL/link behavior, and symlink exclusion remain meaningful within the limits. |
| A13 | Preview and scheduled execution call the same bounded scanner/state contract and cannot bypass save/run authorization or hard ceilings with hand-authored legacy YAML. |

## Invariants and state transitions

| ID | Invariant or transition |
|---|---|
| I1 | YAML owns filesystem configuration; SQLite owns runtime observations. No successful scan writes JSON state after migration. |
| I2 | `complete old state -> running -> complete new state` is atomic; every failure path returns to the old complete state. |
| I3 | Canonical authorization is repeated at run time even when save-time validation previously succeeded. |
| I4 | Existing valid v2/current filesystem behavior and the 6/6 source-types baseline remain green. |

## Errors and boundaries

| ID | Error condition or boundary behavior |
|---|---|
| E1 | Exercise exact and +1 depth, entry, match, total-byte, sidecar-byte/depth/node, per-file-byte, extraction-output, pattern-count/byte, and maxItems boundaries, including multibyte UTF-8. |
| E2 | Use a controlled monotonic clock and abort signal; do not sleep. Timeout and caller cancellation are distinct stable codes and mutate no state. |
| E3 | Use real temporary roots and SQLite files. Include a symlink escape where supported and a deterministic injected swap/open seam for platforms where a real race is unreliable. |
| E4 | Induce insert/update/disappearance-cleanup failure and prove transaction rollback. Use genuinely interleaving promises/connections for concurrency evidence where practical. |
| E5 | Tests never inspect or mutate the repository's `data/runtime.db`, `feed-state/filesystem`, or tracked fixture-state file. |

## Current behavior and RED reason

Current scanning uses lexical `resolve` prefix authorization, `readdir`/`stat` by
path, skips only discovered symlink dirents, traverses and collects the whole
tree before limiting, and performs unbounded sidecar/content/extraction reads.
It writes JSON state after every scan, including scans whose work is not bounded,
and has no managed filesystem-state table, rollback, migration, deadline, or
cancellation contract.

Pre-existing baseline on 2026-09-11:

```text
bun test tests/source-types.test.ts --timeout=30000
6 pass / 0 fail / 10 assertions
```

The focused RED must fail for these missing runtime controls and managed state,
not for import, syntax, fixture, permissions, or platform setup.

## Compatibility and migration invariants

- Preserve valid config/item semantics inside the ceilings and preserve legacy
  first-seen/stable IDs when copying JSON state forward.
- Unsafe or oversized legacy state is skipped/reported, never executed merely
  for compatibility.
- Public file serving UI and filesystem form redesign are not part of this
  slice, but their later paths must reuse the authorization contract.

## Non-goals

- New builder UI, deployment-root selector UX, public `/files/*` serving,
  health-dashboard presentation, live `fs.watch`, PDF/DOCX/OCR extraction, or a
  general database redesign.
- Do not prescribe private helper names, traversal implementation, SQL builder,
  or exact incidental warning prose when a stable code and safe counters express
  the behavior.

## Test constraints

- No live services, wall-clock sleeps, or repository runtime state.
- Assert externally meaningful semantics rather than source text except for a
  narrow architecture guard proving preview/worker dispatch does not bypass the
  bounded scanner.
- GPT-5.6 Luna is the maintainer-authorized temporary test author. It may write
  only under `tests/` and `frontend/e2e/`; the lead must not patch its tests.
- Return a compact manifest mapping A1-A13, I1-I4, and E1-E5 to assertions,
  plus the focused RED command/result and uncovered requirements.

## Acceptance checklist

- [ ] Every ID has a meaningful deterministic assertion.
- [ ] Exact/over, failure rollback, race, concurrency, restart, and migration are covered.
- [ ] Tests fail for intended missing production behavior.
- [ ] Biome and the focused test command run cleanly apart from intended RED.
