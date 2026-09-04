# Dependency audit exception policy

Mkfd v3 ships with **zero known Critical or High advisories** in its resolved
dependency graph. That is a release gate, not a target: a Critical or High
finding must be fixed by upgrading, replacing, or removing the affected
package. It may never be recorded here.

A Moderate or Low finding may be held open only when it is development-only or
demonstrably unreachable from shipped code, and only with a written record
below. Everything else must be resolved before release.

## How the gate runs

- `bun audit` runs against the frozen lock graph in the supply-chain workflow,
  after `bun install --frozen-lockfile`, and fails the job on any advisory.
- `actions/dependency-review-action` separately reviews the dependencies a
  pull request changes. It complements the full-graph audit; it does not
  replace it, because it never inspects the pre-existing graph.
- Neither gate may be softened with `continue-on-error`, `|| true`, or a
  redirect that discards the exit status.

## Record format

Each exception is one object in the JSON block below.

| Field | Meaning |
|---|---|
| `package` | The exact package name. Wildcards are not permitted. |
| `severity` | `moderate` or `low`. Critical and High are never exemptible. |
| `path` | The dependency path that introduces the package. |
| `rationale` | Why the advisory is not reachable in shipped code, or why the package is development-only. |
| `mitigation` | What limits the impact until the exception is retired. |
| `reviewBy` | An ISO calendar date. The exception expires on that date and must be re-justified or removed. |

## Active exceptions

```json
[
  {
    "package": "esbuild",
    "severity": "moderate",
    "path": "drizzle-kit > esbuild",
    "advisory": "GHSA-67mh-4wv8-2f99",
    "rationale": "Reached only through drizzle-kit, a devDependency used by the db:generate script. The advisory requires esbuild's development server to be running and reachable; Mkfd never starts it, and no shipped runtime path imports esbuild. It is absent from the production container image.",
    "mitigation": "drizzle-kit is development-only and is not installed in the runtime image. Schema generation runs locally or in CI against trusted input, never against untrusted network callers.",
    "reviewBy": "2026-12-01"
  },
  {
    "package": "esbuild",
    "severity": "low",
    "path": "drizzle-kit > esbuild",
    "advisory": "GHSA-g7r4-m6w7-qqqr",
    "rationale": "Same reachability as the moderate advisory above: arbitrary file read requires running esbuild's development server on Windows, which Mkfd never does. Not present in shipped code.",
    "mitigation": "Development-only dependency, excluded from the runtime image. Retire this exception when drizzle-kit ships a release that raises its esbuild floor.",
    "reviewBy": "2026-12-01"
  }
]
```

Both entries are development-only advisories in drizzle-kit's bundled esbuild.
Neither package is installed in the runtime container image, and neither
advisory is reachable from shipped code. The full-graph audit gate runs at
`--audit-level=high`, so these Moderate and Low findings do not fail the build;
recording them here is what makes that a deliberate, dated decision rather
than silence.

No Critical or High advisory is exempted, and none may be.
