# ADR 0001: Mkfd v3 release scope and security boundaries

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decision owners:** Product owner and v3 implementation lead
- **Supersedes:** Conflicting provisional recommendations in earlier feature plans and audits

## Context

The major revision contains substantial implementation, but its feature documents, runtime registry, and UI do not consistently describe the same product. The release also cannot close security findings by silently removing useful v2 behavior.

## Decisions

1. The supported v3 source list is frozen to web scraping, REST API, email, existing-feed transformer, sitemap, calendar, GraphQL, webhook ingress, filesystem, and service connector.
2. A top-level `changeDetection` source type is not part of v3. Stale type entries, routes, or recommendations must be removed or mapped to a supported source. Sitemap's documented disabled future mode may remain visibly unavailable but must not be accepted as a runnable v3 source.
3. Selector Playground remains supported with all 16 v2 destinations. It must use the isolated, sanitized, nonce-bound opaque-origin design specified by the roadmap; removing it is not an acceptable security fix.
4. FlareSolverr remains supported for explicitly configured web-scraping flows. It must use the hardened adapter and shared outbound policy; automatic fallback is not allowed.
5. V2 behavior and stored fields with a clear use case are compatibility requirements. Intentional removal requires a new accepted product decision and a release-note entry.
6. The Mkfd repository is the Community Catalog authority. Entries arrive through reviewed pull requests under `community-catalog/`; running instances use the published `main` manifest with raw-GitHub and last-known-good fallback.
7. Security boundaries are shared platform contracts, not feature-local exceptions: authentication, protected values, outbound networking, limits, settings, logging, and config normalization are completed before expanding reachable source behavior.
8. Every implementation slice follows the separated-role TDD protocol in `AGENTS.md`. Claude Code Sonnet 5 authors and revises tests; Codex reviews and implements without modifying those tests.

## Consequences

- Packet owners may not reopen these decisions without a replacement ADR approved by the product owner.
- Specs or plans that list `changeDetection` as a top-level source are historical input, not current authority.
- Selector Playground and FlareSolverr security work must demonstrate preserved functionality as well as isolation.
- The implementation ledger is the only status record for packet execution evidence; `PROGRESS.md` remains the feature-level readiness view.

## Release authority

`docs/mkfd-v3-implementation-roadmap.md` defines ordering and release gates. This ADR defines product scope when older documents conflict with it.
