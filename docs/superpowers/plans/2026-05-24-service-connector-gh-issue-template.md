# Service Connector GH Issue Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured GitHub issue form for connector requests, a maintainer review checklist, a connector spec template, and CONTRIBUTING.md triage documentation.

**Architecture:** Pure repository configuration and documentation — no application code. Four files: issue form YAML, review checklist, spec template, and CONTRIBUTING.md additions.

**Tech Stack:** GitHub issue forms (YAML), Markdown

---

### Task 1: Create the GitHub issue form

**Files:**
- Create: `.github/ISSUE_TEMPLATE/service-connector-request.yml`

- [ ] **Step 1: Create `.github/ISSUE_TEMPLATE/` directory if it doesn't exist and write the issue form**

```yaml
name: Service connector request
description: Request a new first-class Mkfd service connector.
title: "[Service Connector]: "
labels:
  - enhancement
  - service-connector
  - needs-triage
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a new Mkfd service connector.

        Service connectors turn structured services, apps, platforms, and homelab tools into RSS, Atom, and JSON Feed outputs.

        Good connector requests explain what service should be connected, what resources should become feeds, and how Mkfd would authenticate safely.

  - type: input
    id: service-name
    attributes:
      label: Service name
      description: What service, app, or platform should Mkfd connect to?
      placeholder: Jellyfin, Plex, GitHub, Discord, Home Assistant, Sonarr, etc.
    validations:
      required: true

  - type: input
    id: service-url
    attributes:
      label: Service website or repository
      description: Link to the service homepage, documentation, or source repository.
      placeholder: https://jellyfin.org
    validations:
      required: true

  - type: dropdown
    id: service-category
    attributes:
      label: Service category
      description: Which category best describes this service?
      options:
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
    validations:
      required: true

  - type: dropdown
    id: hosting-model
    attributes:
      label: Hosting model
      description: Is this service usually self-hosted, cloud-hosted, or both?
      options:
        - Mostly self-hosted
        - Mostly cloud-hosted
        - Both self-hosted and cloud-hosted
        - Not sure
    validations:
      required: true

  - type: textarea
    id: feed-use-cases
    attributes:
      label: What feeds should Mkfd be able to create?
      description: List the concrete feed ideas this connector should support.
      placeholder: |
        - Recently added movies
        - Recently added TV episodes
        - New GitHub releases
        - New Discord channel messages
        - Home Assistant alerts
    validations:
      required: true

  - type: textarea
    id: resources
    attributes:
      label: What resources should users be able to select?
      description: Describe selectable resources such as libraries, repositories, channels, projects, folders, users, playlists, collections, or devices.
      placeholder: |
        - Library
        - Collection
        - Channel
        - Repository
        - Project
        - Device
        - Playlist
    validations:
      required: true

  - type: textarea
    id: presets
    attributes:
      label: Suggested connector presets
      description: Presets are ready-made feed modes like "latest items", "new releases", or "channel messages".
      placeholder: |
        - latestItems
        - recentlyAddedMovies
        - recentlyAddedEpisodes
        - releases
        - issues
        - channelMessages
    validations:
      required: false

  - type: input
    id: api-docs
    attributes:
      label: API documentation
      description: Link to official API docs if available.
      placeholder: https://api.example.com/docs
    validations:
      required: false

  - type: dropdown
    id: auth-method
    attributes:
      label: Authentication method
      description: What kind of authentication does this service use?
      options:
        - No authentication
        - API key
        - Bearer token
        - Bot token
        - Basic auth
        - OAuth2
        - Session/cookie
        - Unknown
        - Other
    validations:
      required: true

  - type: textarea
    id: auth-details
    attributes:
      label: Authentication details
      description: Explain anything important about authentication, token creation, permissions, scopes, or read-only access.
      placeholder: |
        Example:
        Jellyfin uses an API key.
        Discord should use a bot token with View Channel and Read Message History permissions.
        GitHub should use a fine-grained token or GitHub App permissions.
    validations:
      required: false

  - type: dropdown
    id: api-availability
    attributes:
      label: API availability
      description: Does this service have an official API?
      options:
        - Official API exists
        - Unofficial API exists
        - No API, but data is available through files or exports
        - No API known
        - Not sure
    validations:
      required: true

  - type: textarea
    id: sample-response
    attributes:
      label: Sample API response or data shape
      description: Paste a small sanitized sample response, object shape, or link to example API output. Do not include secrets.
      render: json
      placeholder: |
        {
          "Items": [
            {
              "Id": "abc123",
              "Name": "Example Item",
              "DateCreated": "2026-05-17T00:00:00Z"
            }
          ]
        }
    validations:
      required: false

  - type: textarea
    id: feed-item-mapping
    attributes:
      label: Suggested feed item mapping
      description: How should service data map into feed items?
      placeholder: |
        title: item name
        description: overview or body
        link: item URL
        date: created/added/published date
        author: service/user/channel
        categories: library/type/tags
        enclosure: image/poster/attachment
    validations:
      required: false

  - type: textarea
    id: existing-feeds
    attributes:
      label: Existing feed support
      description: Does this service already expose RSS, Atom, JSON Feed, webhooks, or notifications?
      placeholder: |
        It has no RSS support.
        It has webhooks but no feed support.
        It exposes an RSS feed, but it is limited.
    validations:
      required: false

  - type: textarea
    id: safety-privacy
    attributes:
      label: Privacy, security, or safety concerns
      description: Mention private data, private network access, rate limits, scopes, sensitive content, or anything Mkfd should avoid.
      placeholder: |
        This may expose private media libraries.
        Generated feeds should default to private/local-only.
        API key should be read-only if possible.
        Avoid using user tokens or browser scraping.
    validations:
      required: false

  - type: dropdown
    id: testing-availability
    attributes:
      label: Can you help test this connector?
      description: Connector requests are easier to build if someone can test against a real instance.
      options:
        - Yes, I can test it
        - Yes, I can provide sanitized sample responses
        - Maybe
        - No
    validations:
      required: true

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add screenshots, links, examples, related issues, or implementation notes.
    validations:
      required: false

  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I have searched existing issues for this connector request.
          required: true
        - label: I did not include passwords, API keys, tokens, cookies, or private URLs in this issue.
          required: true
        - label: I understand service connector feeds may expose private service data if the generated feed URL is shared.
          required: true
```

- [ ] **Step 2: Verify the file parses as valid YAML**

```bash
bun -e "const fs = require('fs'); const yaml = require('js-yaml'); yaml.load(fs.readFileSync('.github/ISSUE_TEMPLATE/service-connector-request.yml', 'utf8')); console.log('valid')"
```

Expected: prints `valid` (or install `js-yaml` first: `bun add -d js-yaml`)

If `js-yaml` is not available, visually check the YAML structure.

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE/service-connector-request.yml
git commit -m "feat: add service connector request issue template"
```

---

### Task 2: Create the maintainer review checklist

**Files:**
- Create: `docs/service-connector-review.md`

- [ ] **Step 1: Write the review checklist**

```markdown
# Service Connector Review Checklist

Use this checklist when evaluating a service connector request issue.

## Fit

- [ ] This service has resources that naturally become feed items.
- [ ] This should be a service connector rather than a REST/API config.
- [ ] This connector benefits from service-specific resource discovery, presets, or auth handling.

## API

- [ ] Official API exists.
- [ ] API supports read-only access.
- [ ] API supports pagination or sensible limits.
- [ ] API exposes stable item IDs.
- [ ] API exposes dates suitable for feed item dates.

## Authentication

- [ ] Authentication can be stored as ProtectedValue.
- [ ] Read-only tokens or scoped permissions are available.
- [ ] No user-token automation is required.
- [ ] No private web UI scraping is required.

## Feed model

- [ ] Resource types are identified.
- [ ] Presets are identified.
- [ ] Item mapping is clear.
- [ ] Link strategy is clear.
- [ ] Enclosure/image strategy is clear.

## Safety

- [ ] Generated feeds may expose private data. (noted, not blocking)
- [ ] Connector should default to `localOnly`/`private` if appropriate.
- [ ] Rate limit behavior is understood.
- [ ] Sensitive fields will not be logged.

## Testing

- [ ] Someone can test against a real instance.
- [ ] Sample API response is available.

---

## Issue lifecycle

```
needs-triage
  → accepted
  → needs-design
  → ready-for-implementation
  → in-progress
  → done
```

Rejected or redirected:

| Label | Meaning |
|---|---|
| `not-planned` | Not a fit for Mkfd |
| `duplicate` | Duplicate of another request |
| `better-as-rest-config` | Should use a REST/API feed config instead |
| `better-as-webhook-feed` | Should use a webhook feed instead |
| `better-as-existing-feed-transformer` | Service already has feeds; use Existing Feed Transformer |
| `blocked:no-api` | No public API available |
| `blocked:unsafe-auth` | Auth cannot be stored safely |
| `blocked:needs-api-docs` | API docs not available |
| `blocked:needs-test-access` | No one can test the connector |
| `security-review` | Needs security review before acceptance |
```

- [ ] **Step 2: Commit**

```bash
git add docs/service-connector-review.md
git commit -m "docs: add service connector review checklist"
```

---

### Task 3: Create the connector spec template

**Files:**
- Create: `docs/templates/service-connector-spec.md`

- [ ] **Step 1: Write the spec template**

```markdown
# Service Connector Spec: {service}

**Based on issue:** #

---

## Service

| Field | Value |
|---|---|
| Name | |
| Category | |
| Hosting model | |
| Website | |
| API docs | |

## Auth

| Field | Value |
|---|---|
| Mode | API key / bearer / basic / OAuth2 / other |
| Required fields | |
| Optional fields | |
| Required permissions/scopes | |

## Resources

| Type | Label | Parent | Notes |
|---|---|---|---|
| | | | |

## Presets

| Preset | Resource type | Description |
|---|---|---|
| | | |

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| | | | |

## Item Mapping

| Feed field | Service field | Notes |
|---|---|---|
| id | | |
| title | | |
| description | | |
| link | | |
| date | | |
| author | | |
| categories | | |
| enclosure | | |

## State

| Field | Description |
|---|---|
| Cursor strategy | |
| `lastSeenId` | |
| `lastSeenAt` | |

## Privacy

| Field | Value |
|---|---|
| `localOnly` default | true / false |
| `private` visibility default | true / false |
| Warnings | |

## Implementation files

- `utilities/service-connectors/{service}.connector.ts`
- `tests/service-connectors/{service}.connector.test.ts`
- `docs/service-connectors/{service}.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/templates/service-connector-spec.md
git commit -m "docs: add service connector spec template"
```

---

### Task 4: Update CONTRIBUTING.md

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Read the current CONTRIBUTING.md to find the right insertion point**

```bash
cat CONTRIBUTING.md
```

- [ ] **Step 2: Add the Service Connector Requests section**

Add the following section. If CONTRIBUTING.md already has sections, append after the last section before any closing notes. If CONTRIBUTING.md is minimal, add at the end.

```markdown
## Service Connector Requests

If you want to request a new service connector, use the [Service Connector Request issue template](.github/ISSUE_TEMPLATE/service-connector-request.yml).

### Triage criteria

When evaluating a connector request, the maintainers will check:

1. Is there a stable API?
2. Can the connector be read-only?
3. Can authentication be stored safely as `ProtectedValue`?
4. Does the service expose resources that naturally map to feeds?
5. Are there obvious presets?
6. Is this connector useful to self-hosted users?
7. Can it be implemented without scraping private web UIs?
8. Can someone test it?
9. Are there privacy risks?
10. Should this be a service connector, a REST config, a webhook feed, or an existing-feed transformer instead?

See [docs/service-connector-review.md](docs/service-connector-review.md) for the full review checklist.

### Issue lifecycle

```
needs-triage → accepted → needs-design → ready-for-implementation → in-progress → done
```

If a request is not accepted, it will be labeled with one of:
`not-planned`, `duplicate`, `better-as-rest-config`, `better-as-webhook-feed`,
`better-as-existing-feed-transformer`, `blocked:unsafe-auth`, `blocked:no-api`.
```

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add service connector request triage guide to CONTRIBUTING.md"
```

---

### Task 5: Update PROGRESS.md

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Mark Service Connector GH Issue Template spec and plan complete**

In `docs/superpowers/PROGRESS.md`, update:

```
| Service Connector GH Issue Template | ✅ | ✅ | ⬜ |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: mark service connector GH issue template spec and plan complete"
```
