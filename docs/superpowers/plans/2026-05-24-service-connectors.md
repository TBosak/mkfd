# Service Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `feedType: serviceConnector` as a normal Mkfd feed config backed by a connector registry, SQLite runtime state, and a Jellyfin reference adapter. The first delivery should support test connection, resource discovery, preview, save, and worker refresh without introducing a separate connector config system.

**Architecture:** `models/service-connector.model.ts` defines the connector data shapes; `utilities/service-connector-registry.utility.ts` exposes available connectors and presets; `utilities/service-connector-runner.utility.ts` resolves auth and executes the adapter; `utilities/service-connector-state.utility.ts` persists cursors and runtime metadata in SQLite; `utilities/service-connectors/jellyfin.connector.ts` implements the reference adapter; `routes/service-connectors.ts` serves list/test/resources/preview endpoints; `workers/feed-updater.worker.ts` refreshes connector feeds; `frontend/src/components/forms/ServiceConnectorForm.tsx` provides the UI.

**Tech Stack:** Bun, TypeScript, Hono, React 18, shadcn/ui, bun:test, SQLite runtime substrate, existing protected-value helpers, existing feed-format serialization

**Depends on:** Feed Config Formalization, Protected Value Encryption, SQLite Runtime Substrate + Feed History, Feed Format Refactor, Normalized Feed Item Pipeline

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `models/service-connector.model.ts` | Connector, auth, resource, cursor, state, result types |
| Modify | `models/feed-config.model.ts` | Add `serviceConnector` and `FeedType` entry |
| Create | `utilities/service-connector-registry.utility.ts` | Connector registry, preset metadata, resource schemas |
| Create | `utilities/service-connector-runner.utility.ts` | Resolve auth, call connector adapter, normalize items |
| Create | `utilities/service-connector-state.utility.ts` | Load/save connector state and cursors in SQLite |
| Create | `utilities/service-connectors/jellyfin.connector.ts` | Jellyfin reference adapter |
| Modify | `utilities/rss-builder.utility.ts` | Build feed output from normalized connector items |
| Create | `routes/service-connectors.ts` | `GET /service-connectors`, `POST /service-connectors/:service/test`, `POST /service-connectors/:service/resources`, `POST /service-connectors/:service/preview` |
| Modify | `workers/feed-updater.worker.ts` | Add `serviceConnector` refresh path |
| Modify | `index.ts` or router registration | Wire the service connector routes into the app |
| Create | `frontend/src/components/forms/ServiceConnectorForm.tsx` | Service connector builder UI |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Add Service Connector tab |
| Create | `tests/service-connectors/*.test.ts` | Model, registry, adapter, route, and worker tests |

---

## Task 1: Connector model and feed config wiring

**Files:**
- Create: `models/service-connector.model.ts`
- Modify: `models/feed-config.model.ts`

- [ ] Create the connector model file with config, auth, resource, cursor, item, state, and result types.
- [ ] Add `serviceConnector` to the `FeedType` union and add `serviceConnector?: ServiceConnectorConfig` to `FeedConfig`.
- [ ] Ensure auth fields use `ProtectedValue` so plain secrets are not accepted by the type layer.
- [ ] Add model coverage for a valid Jellyfin config and rejected missing-auth cases.

## Task 2: Registry and runner

**Files:**
- Create: `utilities/service-connector-registry.utility.ts`
- Create: `utilities/service-connector-runner.utility.ts`
- Create: `tests/service-connectors/registry.test.ts`

- [ ] Define the connector registry shape and make Jellyfin appear in the list.
- [ ] Expose connector metadata for test/resources/preview flows without leaking implementation functions through the list endpoint.
- [ ] Add a runner that resolves protected auth, validates the selected connector, and returns normalized feed items plus next-state data.
- [ ] Add tests for unknown connector handling, registry listing, and preset lookup.

## Task 3: SQLite state store

**Files:**
- Create: `utilities/service-connector-state.utility.ts`
- Modify: SQLite runtime substrate files already used by the repo

- [ ] Add runtime state access for connector cursors, last-seen markers, and rate-limit metadata.
- [ ] Keep all connector runtime data out of `/app/configs`.
- [ ] Add tests that verify state is read and written by feed id and resource identity.

## Task 4: Jellyfin reference adapter

**Files:**
- Create: `utilities/service-connectors/jellyfin.connector.ts`
- Create: `tests/service-connectors/jellyfin.test.ts`

- [ ] Implement connection test, library discovery, and latest-items mapping for Jellyfin.
- [ ] Normalize media items into the shared feed item shape used by the RSS builder.
- [ ] Add tests for valid connection flow, auth failure, library listing, and item shaping.

## Task 5: Backend routes and preview/save integration

**Files:**
- Create: `routes/service-connectors.ts`
- Modify: `index.ts` or router registration
- Modify: `utilities/rss-builder.utility.ts`
- Modify: `utilities/feed-config-validator.utility.ts`
- Modify: preview/save paths that already handle typed feed configs

- [ ] Add `GET /service-connectors` to list connector definitions.
- [ ] Add `POST /service-connectors/:service/test` to verify auth and connectivity while masking secrets in responses.
- [ ] Add `POST /service-connectors/:service/resources` to return discoverable resources such as Jellyfin libraries.
- [ ] Add `POST /service-connectors/:service/preview` to return normalized feed items without saving.
- [ ] Extend preview and save paths so `feedType: serviceConnector` works like the other typed feed configs.
- [ ] Add validation that rejects plain auth values and enforces private-by-default metadata.

## Task 6: Worker integration and feed output

**Files:**
- Modify: `workers/feed-updater.worker.ts`
- Modify: `utilities/rss-builder.utility.ts`

- [ ] Add a `serviceConnector` worker branch that loads config, resolves auth, calls the connector runner, writes feed output, and persists state.
- [ ] Ensure worker errors surface as health failures without crashing the feed loop.
- [ ] Keep output serialization aligned with the existing feed-format pipeline.

## Task 7: Frontend builder UI

**Files:**
- Create: `frontend/src/components/forms/ServiceConnectorForm.tsx`
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] Add a Service Connector tab to the feed builder.
- [ ] Build a Jellyfin-first UI for auth, resource selection, preset, options, and preview.
- [ ] Keep auth fields masked and sticky when editing existing saved configs.
- [ ] Ensure the UI defaults to private/local-only behavior.

## Task 8: Verification and acceptance

**Files:**
- Create: `tests/service-connectors/service-connector-route.test.ts`
- Create: `tests/service-connectors/service-connector-worker.test.ts`

- [ ] Verify that service connector configs save as normal YAML with no plaintext auth.
- [ ] Verify that test/resources/preview routes work against the Jellyfin mock.
- [ ] Verify that the worker refresh path writes RSS output and persists state.
- [ ] Verify that community catalog submission remains blocked for `serviceConnector`.

---

## Testing Strategy

- Model tests cover config typing, default metadata, and auth constraints.
- Registry tests cover connector discovery and invalid connector handling.
- Adapter tests cover connection, resource discovery, and item normalization.
- Route tests cover masking, preview, and resource discovery endpoints.
- Worker tests cover refresh, state persistence, and failure reporting.
- Security tests confirm that saved YAML and API responses do not leak secrets.

---

## Rollout Notes

- Jellyfin is the only required connector for MVP.
- Additional connectors should be added behind the same registry and runner shape, not by creating one-off code paths.
- Any future connector that needs new runtime state should extend the existing SQLite tables rather than creating a new persistence format.

