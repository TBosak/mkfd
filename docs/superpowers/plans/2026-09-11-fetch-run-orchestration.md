# Fetch Run Orchestration — Implementation Plan

**Status:** Ready for RED

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `models/fetch-policy.model.ts` | Typed safe attempts, results, and terminal errors |
| Modify | `utilities/fetch-policy.utility.ts` | One deadline-aware retry/fallback/cancellation state machine |
| Modify | `utilities/web-scraping-fetcher.utility.ts` | Supply the approved advanced adapter/config and cancellation signal |
| Modify if required | `utilities/existing-feed-parser.utility.ts` | Preserve standard policy semantics and propagate cancellation |
| Modify if required | `utilities/source-assistant/observer.utility.ts` | Preserve standard policy semantics and propagate cancellation |
| Test author only | `tests/p3-fetch-run-orchestration.test.ts` | Behavioral slice contract |
| Test author only | `tests/p3-fetch-run-orchestration-wiring.test.ts` | Non-vacuous production integration/architecture contract if needed |

## Order

1. Record the existing focused baseline.
2. Have the authorized Luna test author implement the requirements brief.
3. Review semantic traceability and deterministic RED; return delta feedback
   until complete, then lock the accepted tests.
4. Implement typed safe outcomes without weakening the existing return shape.
5. Implement the bounded state machine with injectable deterministic time/wait
   and transport seams where required by the accepted tests.
6. Route web-scraping advanced/fallback behavior through the approved
   FlareSolverr adapter and preserve standard callers.
7. Reach focused GREEN, run compatibility suites, verify the test lock, then run
   Packet 3 lint/typecheck/catalog/build and browser checks.

## Verification

```text
bun test tests/p3-fetch-run-orchestration*.test.ts
bun test tests/fetch-policy.test.ts tests/web-scraping-form-data.test.ts tests/existing-feed-parser.test.ts tests/source-assistant/analyzers.test.ts
bun run tdd:tests -- verify --id p3-fetch-run-orchestration
bun run typecheck
bun run lint
bun run validate:catalog
bun run build
bun run test:e2e
```

## Deferred adjacent slice

Whole-feed per-ID serialization and the bounded global worker queue follow this
slice. They must coordinate worker triggers rather than individual HTTP calls.
