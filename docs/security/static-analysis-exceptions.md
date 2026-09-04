# Static analysis exception policy

`fallow` gates this repository in two places. `bun run analyze` runs the full
pipeline locally and fails on any finding. CI runs `fallow audit`, which fails
only on findings a change introduces, so the pre-existing backlog never blocks
a pull request while new debt is stopped at the door.

The expected steady state of this document is an **empty array**. Findings are
meant to be fixed, not recorded. An exception is permitted only when a finding
is genuinely blocked on another packet's work; a file that is simply dead must
be deleted instead.

## Record format

| Field | Meaning |
|---|---|
| `path` | The exact file path. Wildcards and bare directories are not permitted. |
| `findingType` | The fallow finding being excepted, e.g. `unused-file`. |
| `owner` | The blocking work, as `Packet <n>` or `V2-<id>`. |
| `rationale` | Why the finding cannot be fixed now. |
| `reviewBy` | An ISO date, no more than one release cycle (90 days) out. |

## Active exceptions

```json
[]
```

There are no active exceptions.

Five currently-unused files are deliberately **not** listed here. They are
protected in `tests/fallow-static-analysis-gate.test.ts` as cited
roadmap-pending work rather than excepted, because deleting them would close a
static-analysis finding by causing a release-blocker regression against locked
product decision 3, which requires a v2 capability be restored or migrated
rather than deleted:

| Path | Owner |
|---|---|
| `frontend/src/components/forms/CookiesManager.tsx` | V2-16, REST API cookie input |
| `frontend/src/components/builder/KVEditor.tsx` | V2-02, header key/value wire shape |
| `frontend/src/components/catalog/CatalogMetadataForm.tsx` | Packet 8 |
| `frontend/src/components/catalog/CatalogSanitizedYamlPreview.tsx` | Packet 8 |
| `frontend/src/components/catalog/CatalogSubmissionDialog.tsx` | Packet 8 |

Those five are the whole of the deferred set. Every other finding fallow
reported at adoption was fixed: nine dead starter-config adapters and six dead
modules deleted, the `data-handler` to `rss-builder` circular dependency
untangled, `domhandler` declared, and the orphaned `@radix-ui/react-accordion`
dependency removed.
