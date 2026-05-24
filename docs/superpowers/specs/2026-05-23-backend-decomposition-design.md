# Backend Route Decomposition — Design Spec

**Date:** 2026-05-23
**Tier:** Phase 3 Prerequisite
**Status:** Approved

---

## Goal

Break `index.ts` (2127 lines) into focused route files and utility modules before Phase 3 features are added. No behavioral changes — same routes, same YAML output format, same worker interfaces.

---

## Scope

### In scope

- Split routes into `routes/feeds.ts`, `routes/preview.ts`, `routes/health.ts`, `routes/utils.ts`
- Extract `buildCSSTarget` and related helpers into `utilities/css-target-builder.utility.ts`
- Extract worker management into `utilities/worker-manager.utility.ts`
- Extract `generatePreview` into `utilities/preview-generator.utility.ts`
- Extract route-level config adaptation into `utilities/feed-config-route-adapter.utility.ts`, delegating schema decisions to Feed Config Formalization utilities
- Preserve the existing `pubDate` mapping behavior through the formalized caster/validator
- Reduce `index.ts` to ~120 lines of wiring

### Out of scope

- Changing any route behavior, response shapes, or YAML config format
- Modifying workers (`workers/feed-updater.worker.ts`, `workers/imap-feed.worker.ts`)
- Frontend changes
- Adding new feed types or features
- Service layer abstraction

---

## Architecture

### Shared state

Route files use factory functions. `index.ts` creates shared dependencies and injects them:

```ts
// index.ts
app.route("/", feedsRouter({ encryptionKey, configsDir }));
app.route("/", previewRouter({ encryptionKey, configsDir }));
app.route("/", healthRouter({ runLogEmitter }));
app.route("/", utilsRouter());
```

Each factory returns a Hono router instance:

```ts
// routes/feeds.ts
export function feedsRouter(deps: { encryptionKey: string; configsDir: string }): Hono {
  const app = new Hono();
  // route registrations...
  return app;
}
```

### Worker manager — module-level singleton

`worker-manager.utility.ts` owns `feedUpdaters` and `feedIntervals` as module-level Maps. They are process-level singletons and do not need injection. The `runLogEmitter` is passed into `initializeWorker` at call time.

```ts
const feedUpdaters: Map<string, Worker> = new Map();
const feedIntervals: Map<string, Timer> = new Map();
let _encryptionKey: string;
let _runLogEmitter: EventEmitter;

export function initWorkerManager(deps: { encryptionKey: string; runLogEmitter: EventEmitter }): void
export function initializeWorker(feedConfig: any): void
export function setFeedUpdaterInterval(feedConfig: any): void
export function clearFeedUpdaterInterval(feedId: string): void
export function clearAllFeedUpdaterIntervals(): void
export async function processFeedsAtStart(configsDir: string): Promise<void>
```

`initWorkerManager` is called once in `index.ts` after `getSecrets()` completes, before `processFeedsAtStart`.

### Config route adapter

`POST /`, `POST /preview`, and `PUT /api/feeds/:id` should not reintroduce a second config schema. The route adapter handles request-only concerns, then delegates to Feed Config Formalization:

```ts
// utilities/feed-config-route-adapter.utility.ts
export async function buildFeedConfigForRoute(
  body: Record<string, any>,
  opts: {
    feedId: string;
    encryptionKey: string;
    sampleHtml?: string;
    existingConfig?: any;   // PUT only: preserves protected values when not re-supplied
    isPreview?: boolean;    // changes feedGenerator to "MkFD Preview Generator"
  }
): Promise<FeedConfig>
```

Internally this calls the formalized caster, normalizer, and validator instead of copying old inline branch logic.

`normalizeUrl` is exported from this file for use by route files that need it (`routes/utils.ts` proxy and flaresolverr health routes).

### Known drift bug — preserved as a regression test

`PUT /api/feeds/:id` previously used `date:` as the `apiMappingData` key while `POST /` used `pubDate:`. The worker reads `pubDate`. The formalized caster remains the source of truth and route decomposition must not regress this.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `routes/feeds.ts` | `POST /`, `GET /api/feeds`, `GET /api/feeds/:id/config`, `PUT /api/feeds/:id`, `POST /delete-feed`, SPA catch-all routes |
| Create | `routes/preview.ts` | `POST /preview` |
| Create | `routes/health.ts` | `GET /api/health/runs`, `GET /api/health/summary`, `GET /api/health/chart/:feedId`, `GET /api/health/settings`, `PUT /api/health/settings`, `GET /api/health/stream` |
| Create | `routes/utils.ts` | `GET /proxy` (local `injectSelectorGadget`), `GET /passkey`, `POST /imap/folders`, `POST /utils/suggest-selectors`, `POST /api/flaresolverr/health`, `POST /utils/root-url`, `POST /trigger-webhook` |
| Create | `utilities/feed-config-route-adapter.utility.ts` | `buildFeedConfigForRoute`, `normalizeUrl`; delegates to formalized config caster/validator |
| Create | `utilities/css-target-builder.utility.ts` | `buildCSSTarget`, `parseDrillChain`, `determineIsRelativeAndBaseUrl`, `extractSampleUrlFromHtml`, `isLikelyAbsoluteUrl` |
| Create | `utilities/worker-manager.utility.ts` | `initializeWorker`, `setFeedUpdaterInterval`, `clearFeedUpdaterInterval`, `clearAllFeedUpdaterIntervals`, `processFeedsAtStart`; owns `feedUpdaters`/`feedIntervals` Maps |
| Create | `utilities/preview-generator.utility.ts` | `generatePreview` |
| Modify | `index.ts` | Strip to: imports, `prompt()`, `getSecrets()`, app + middleware init, route mounting, server export, signal handlers (~120 lines) |

---

## What Stays in `index.ts`

- `prompt()` CLI helper (used only in `getSecrets()`)
- `getSecrets()` (top-level async init, must run before anything else)
- `new Hono()`, `new EventEmitter()`, `new CookieStore()`
- Directory creation (`feedPath`, `configsDir`)
- `initDb()` call
- Session + auth middleware registration
- Route mounting via factory calls
- `export default { port: 5000, fetch: app.fetch, idleTimeout: 120 }`
- `process.on("exit" | "SIGINT" | "SIGTERM")` signal handlers

---

## Dependencies

- No new npm packages
- Feed Config Formalization must be complete first; this plan reuses its caster/normalizer/validator.
- Outbound Fetch Policy must be complete first; moved routes must preserve those checks.
- Phase 3 features (Existing Feed Transformer) depend on this decomposition being complete — the transformer adds new feed-type support through the formalized config utilities and new route wiring.

---

## Tests

### Unit tests (new)

`tests/feed-config-route-adapter.test.ts`
- `buildFeedConfigForRoute` delegates to the formalized config caster and validator
- API/REST route adaptation uses `pubDate` not `date` in `apiMappingData`
- Existing protected values are preserved when replacement plaintext is not supplied
- Preview route adaptation marks preview generator behavior without changing persisted config semantics

`tests/css-target-builder.test.ts`
- `isLikelyAbsoluteUrl` — absolute/relative/protocol-relative cases
- `determineIsRelativeAndBaseUrl` — auto-detect, explicit override, fallback to feedUrl

### Type check

```bash
cd frontend && bun run tsc --noEmit   # frontend unchanged — should be clean
bun run tsc --noEmit                   # backend — run after each task
```

### Smoke test (manual, after final task)

```
[ ] bun run dev starts without errors
[ ] POST / creates a new feed YAML in configs/
[ ] POST /preview returns RSS XML
[ ] GET /api/feeds returns feed list
[ ] PUT /api/feeds/:id updates YAML and restarts worker
[ ] GET /api/health/runs returns paginated rows
[ ] GET /api/health/stream opens SSE connection
[ ] GET /proxy proxies a URL and injects SelectorGadget script
[ ] All existing routes respond with same status codes as before
```
