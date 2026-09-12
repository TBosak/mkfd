# Filesystem Runtime Controls — Implementation Plan

**Date:** 2026-09-11
**Status:** Approved
**Spec:** `docs/superpowers/specs/2026-09-11-filesystem-runtime-controls-design.md`

## File map

- `models/filesystem.model.ts`: bounded policy/result/error and state types.
- `utilities/filesystem-feed.utility.ts`: canonical authorization, bounded
  traversal, safe reads, item mapping, and completed-scan state transition.
- `lib/analytics/schema.ts`, `drizzle/migrations/`: managed filesystem state.
- `lib/analytics/db.ts`: transactional state store and idempotent JSON-state
  copy-forward.
- `utilities/feed-config-validator.utility.ts` and the existing config-save
  path: validate policy and authorized canonical root at persistence time.
- `workers/feed-updater.worker.ts` and preview dispatch: share the bounded scan
  operation; no local bypasses.
- `tests/p3-filesystem-runtime-controls.test.ts`: Luna-authored semantic suite.

## Order

1. Record the existing filesystem test baseline and author the requirements
   brief with stable IDs.
2. Have the authorized Luna test author produce focused real-directory and
   SQLite tests; perform one semantic review and delta revisions until accepted.
3. Lock the accepted RED tests.
4. Add the managed migration/state store, then the canonical path and bounded
   scanner implementation, without changing accepted tests.
5. Wire save-time validation and existing preview/worker consumers to the same
   contract.
6. Run focused GREEN, existing filesystem/config/preview/worker compatibility,
   lock verification, Packet 3 architecture gates, typecheck, lint, build, and
   the broader core suite appropriate to the slice.
7. Record evidence in the roadmap ledger. Do not mark Runtime Resource Controls
   ready until the convergence slice is also complete.

## Verification strategy

- Use real temporary directory trees and temporary SQLite files.
- Inject clock/deadline/cancellation and path-operation seams only where needed
  to make externally observable races deterministic.
- Assert no state mutation after every failed or cancelled scan.
- Prove restart and idempotent legacy copy-forward.
- Preserve the existing 6/6 `tests/source-types.test.ts` baseline.
