# Service Connector GH Issue Template — Design Spec

**Date:** 2026-05-24
**Tier:** R4 Catalog & Import
**Status:** Approved

---

## Goal

Add a structured GitHub issue form that lets community members request new Mkfd service connectors. The form collects enough information to evaluate fit (API stability, auth, feed mapping, privacy) and routes requests into a predictable triage lifecycle. Also adds a maintainer review checklist and a connector spec template for turning accepted requests into implementation designs.

---

## Scope

### In scope (MVP)

- `.github/ISSUE_TEMPLATE/service-connector-request.yml` — structured GitHub issue form
- `docs/service-connector-review.md` — maintainer review checklist
- `docs/templates/service-connector-spec.md` — connector spec template for accepted requests
- CONTRIBUTING.md section on connector request triage criteria and lifecycle labels

### Out of scope (MVP)

- GitHub Actions automation for auto-labeling by category or service name
- Bot responses or auto-generated connector spec from issue content
- Connector request tracking dashboard

---

## Architecture

This feature is entirely documentation and repository configuration — no application code.

| File | Responsibility |
|---|---|
| `.github/ISSUE_TEMPLATE/service-connector-request.yml` | GitHub issue form for connector requests |
| `docs/service-connector-review.md` | Maintainer review checklist |
| `docs/templates/service-connector-spec.md` | Connector spec template |
| `CONTRIBUTING.md` | Triage criteria + lifecycle label documentation |

---

## Issue Form

### `.github/ISSUE_TEMPLATE/service-connector-request.yml`

The form uses GitHub issue forms (structured YAML, not Markdown template). Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `service-name` | input | yes | Service name |
| `service-url` | input | yes | Homepage or repo URL |
| `service-category` | dropdown | yes | Maps to `ServiceConnectorCategory` |
| `hosting-model` | dropdown | yes | Self-hosted / cloud / both / not sure |
| `feed-use-cases` | textarea | yes | Concrete feed ideas |
| `resources` | textarea | yes | Selectable resources (libraries, channels, repos) |
| `presets` | textarea | no | Suggested preset names |
| `api-docs` | input | no | API docs URL |
| `auth-method` | dropdown | yes | API key / bearer / basic / OAuth2 / etc. |
| `auth-details` | textarea | no | Scopes, token creation, read-only notes |
| `api-availability` | dropdown | yes | Official / unofficial / files / none / unknown |
| `sample-response` | textarea | no | Sanitized JSON sample (render: json) |
| `feed-item-mapping` | textarea | no | title/link/date/author/enclosure mapping |
| `existing-feeds` | textarea | no | Whether service already has RSS/webhooks |
| `safety-privacy` | textarea | no | Private data, rate limits, scoping concerns |
| `testing-availability` | dropdown | yes | Can test / can provide samples / maybe / no |
| `additional-context` | textarea | no | Screenshots, links, notes |
| `checklist` | checkboxes | yes | No secrets, searched existing issues, privacy acknowledgement |

Labels auto-applied: `enhancement`, `service-connector`, `needs-triage`

Category dropdown options:
- Media server
- Developer platform
- Community/chat
- Automation/home
- Downloads/torrents
- Photos/media library
- Books/comics/audiobooks
- Productivity/knowledge base
- Social/web platform
- Other

---

## Maintainer Review Checklist

### `docs/service-connector-review.md`

Six sections: Fit, API, Authentication, Feed model, Safety, Testing.

Each section uses checkboxes. Key checks:

- **Fit**: Resources naturally become feed items; should be connector not REST config; benefits from service-specific resource discovery
- **API**: Official API exists, read-only access, pagination, stable item IDs, date fields
- **Auth**: ProtectedValue compatible, read-only scopes, no UI scraping
- **Feed model**: Resource types, presets, item mapping, link strategy, enclosure strategy
- **Safety**: May expose private data (note), localOnly defaults, rate limits understood, no sensitive logging
- **Testing**: Someone can test real instance, sample API response available

---

## Connector Spec Template

### `docs/templates/service-connector-spec.md`

Lightweight fill-in template for converting an accepted issue into a connector implementation spec. Sections: Service, Auth, Resources table, Presets table, Options table, Item Mapping table, State, Privacy, Implementation files.

---

## CONTRIBUTING.md Additions

### Triage criteria

Document these evaluation criteria under a "Service Connector Requests" section:

1. Is there a stable API?
2. Can the connector be read-only?
3. Can authentication be stored safely as ProtectedValue?
4. Does the service expose resources that naturally map to feeds?
5. Are there obvious presets?
6. Is this connector useful to self-hosted users?
7. Can it be implemented without scraping private web UIs?
8. Can someone test it?
9. Are there privacy risks?
10. Should this be a service connector, REST config, webhook feed, or existing-feed transformer?

### Issue lifecycle labels

```
needs-triage → accepted → needs-design → ready-for-implementation → in-progress → done
```

Rejection/redirect labels:
- `not-planned`
- `duplicate`
- `better-as-rest-config`
- `better-as-webhook-feed`
- `better-as-existing-feed-transformer`
- `blocked:unsafe-auth`
- `blocked:no-api`
- `blocked:needs-api-docs`
- `blocked:needs-test-access`
- `security-review`

---

## Acceptance Criteria

- `.github/ISSUE_TEMPLATE/service-connector-request.yml` exists and uses GitHub issue form syntax
- Form collects service, API, auth, resources, presets, privacy, and testing details
- Form reminds users not to include secrets (checklist item, required)
- New issues are auto-labeled `service-connector` and `needs-triage`
- `docs/service-connector-review.md` contains maintainer review checklist
- CONTRIBUTING.md documents triage criteria and lifecycle labels
- `docs/templates/service-connector-spec.md` exists for converting accepted requests to specs

---

## Design Decisions

### 1. Should we add GitHub Actions auto-labeling?

**Options:**
- A. No automation — manual triage only (MVP)
- B. Add a GitHub Actions workflow that reads the category dropdown and applies `category:*` labels
- C. Add a workflow that also posts a triage checklist comment on new issues

**Chosen: A.** The automation is nice-to-have but introduces workflow maintenance overhead and GitHub token permission requirements. Manual triage is sufficient at current scale. Auto-labeling can be added later when the volume of connector requests warrants it.

---

### 2. Where should triage documentation live?

**Options:**
- A. Add a "Service Connector Requests" section to `CONTRIBUTING.md`
- B. Create a standalone `docs/connector-triage.md`
- C. Put triage docs in `community-catalog/README.md`

**Chosen: A.** CONTRIBUTING.md is where contributors look first. The triage section belongs alongside other contribution guidance. A separate file adds navigation friction with no benefit at this scope.

---

### 3. Should the connector spec template be in `docs/templates/` or somewhere else?

**Options:**
- A. `docs/templates/service-connector-spec.md`
- B. `docs/service-connectors/spec-template.md`
- C. Embedded in CONTRIBUTING.md

**Chosen: A.** A `docs/templates/` directory creates a natural home for future templates (e.g., feed type spec templates). Embedding in CONTRIBUTING.md would make that file unwieldy.

---

### 4. Should we include per-service labels like `connector:jellyfin`?

**Options:**
- A. Only core labels: `service-connector`, `needs-triage`, `security-review`, `blocked:needs-api-docs`, `blocked:needs-test-access`
- B. Add per-service labels for popular connectors (connector:jellyfin, connector:plex, etc.)
- C. Add both core and category labels (`category:media`, `category:developer`, etc.)

**Chosen: A.** Per-service labels add setup overhead and become stale as connector priorities shift. Core labels provide enough triage signal. Category labels can be added if/when the volume of requests makes filtering useful.
