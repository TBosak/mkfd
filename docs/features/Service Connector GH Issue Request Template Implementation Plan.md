## Goal

Add a GitHub issue template that lets community members request new Mkfd service connectors in a structured way.

This should support requests like:

```text
Jellyfin
Plex
GitHub
Discord
Home Assistant
Sonarr
Radarr
Immich
Audiobookshelf
Komga
Kavita
qBittorrent
Transmission
Notion
Slack
GitLab
YouTube
Reddit
```

The issue template should collect enough information to answer:

```text
Is this service a good fit for Mkfd?
Is there a public API?
What authentication is required?
What resources can become feeds?
What presets would users expect?
Is this connector safe for self-hosted use?
Is it local/homelab, cloud, developer, community, media, etc.?
```

---

# Recommended GitHub issue template structure

Add:

```text
.github/
  ISSUE_TEMPLATE/
    service-connector-request.yml
```

Use a GitHub **issue form** rather than a Markdown template. Issue forms give you required fields, dropdowns, checkboxes, and cleaner structured submissions.

---

# Phase 1: Define request categories

## Connector categories

Use the same categories as the service connector registry:

```yaml
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
```

These should map roughly to the internal model:

```ts
export type ServiceConnectorCategory =
  | "media"
  | "developer"
  | "community"
  | "automation"
  | "downloads"
  | "photos"
  | "books"
  | "other";
```

---

# Phase 2: Define what the issue template should collect

The issue form should ask for:

```text
Service name
Service website/repository
Connector category
Is it self-hosted, cloud-hosted, or both?
API documentation link
Authentication method
Example feed ideas
Resource types
Desired presets
Privacy/safety concerns
Existing RSS/feed support
Why this belongs in Mkfd
Whether the requester can test it
Whether the requester can provide sample API responses
```

The most important fields are:

```text
Service name
API docs
Authentication type
Feed use cases
Resources/presets
Self-hosted/cloud distinction
Testing availability
```

---

# Phase 3: Create issue form

Create:

```text
.github/ISSUE_TEMPLATE/service-connector-request.yml
```

Recommended full template:

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

---

# Phase 4: Add labels

Create or document these labels:

```text
service-connector
needs-triage
connector:jellyfin
connector:plex
connector:github
connector:discord
category:media
category:developer
category:community
category:automation
good-first-connector
blocked:needs-api-docs
blocked:needs-test-access
security-review
```

For MVP, add only the basics:

```text
service-connector
needs-triage
security-review
blocked:needs-api-docs
blocked:needs-test-access
```

Optional later: use GitHub Actions to auto-label based on category or service name.

---

# Phase 5: Add triage workflow

Document how you will evaluate connector requests.

Add this to either:

```text
.github/ISSUE_TEMPLATE/config.yml
CONTRIBUTING.md
community-catalog/README.md
README.md
```

Recommended triage criteria:

```text
1. Is there a stable API?
2. Can the connector be read-only?
3. Can authentication be stored safely as ProtectedValue?
4. Does the service expose resources that naturally map to feeds?
5. Are there obvious presets?
6. Is this connector useful to self-hosted users?
7. Can it be implemented without scraping private web UIs?
8. Can someone test it?
9. Are there privacy risks?
10. Should this be a service connector, a REST config, a webhook feed, or an existing-feed transformer instead?
```

---

# Phase 6: Add connector request issue lifecycle

Use a predictable issue lifecycle:

```text
needs-triage
  -> accepted
  -> needs-design
  -> ready-for-implementation
  -> in-progress
  -> done
```

Rejected or redirected:

```text
not-planned
duplicate
better-as-rest-config
better-as-webhook-feed
better-as-existing-feed-transformer
blocked:unsafe-auth
blocked:no-api
```

Suggested labels:

```text
accepted
needs-design
ready-for-implementation
better-as-rest-config
better-as-webhook-feed
better-as-existing-feed-transformer
blocked:no-api
blocked:unsafe-auth
```

This helps avoid service connectors becoming a dumping ground for every possible integration.

---

# Phase 7: Add a connector request review template

When you review a request, use a consistent checklist.

You can place this in:

```text
docs/service-connector-review.md
```

```md
# Service Connector Review Checklist

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

- [ ] Generated feeds may expose private data.
- [ ] Connector should default to localOnly/private if appropriate.
- [ ] Rate limit behavior is understood.
- [ ] Sensitive fields will not be logged.

## Testing

- [ ] Someone can test against a real instance.
- [ ] Sample API response is available.
```

---

# Phase 8: Add optional auto-generated connector spec

Once an issue is accepted, you can convert it into a service connector implementation spec.

Create a lightweight template:

```text
docs/templates/service-connector-spec.md
```

```md
# Service Connector Spec: {service}

## Service

- Name:
- Category:
- Hosting model:
- Website:
- API docs:

## Auth

- Mode:
- Required fields:
- Optional fields:
- Required permissions/scopes:

## Resources

| Type | Label | Parent | Notes |
|---|---|---|---|

## Presets

| Preset | Resource type | Description |
|---|---|---|

## Options

| Option | Type | Default | Notes |
|---|---|---|---|

## Item Mapping

| Feed field | Service field |
|---|---|
| id | |
| title | |
| description | |
| link | |
| date | |
| author | |
| categories | |
| enclosure | |

## State

- Cursor strategy:
- lastSeenId:
- lastSeenAt:

## Privacy

- localOnly default:
- private visibility default:
- warnings:

## Implementation files

- `utilities/service-connectors/{service}.connector.ts`
- tests:
- docs:
```

---

# Phase 9: README to-do item

Add to the README under nice-to-have / community contribution features:

```md
- [ ] Add GitHub issue template for service connector requests
  - Collect service name, category, API docs, auth method, resource types, desired feed presets, privacy concerns, and testing availability.
  - Use labels such as `service-connector`, `needs-triage`, `blocked:needs-api-docs`, and `blocked:needs-test-access`.
  - Add a review checklist to decide whether a request should become a service connector, REST config, webhook feed, or existing-feed transformer.
```

---

# Phase 10: Acceptance criteria

This feature is done when:

```text
.github/ISSUE_TEMPLATE/service-connector-request.yml exists.
The issue form collects service, API, auth, resource, preset, privacy, and testing details.
The template reminds users not to include secrets.
New issues are labeled service-connector and needs-triage.
The README or CONTRIBUTING docs explain how connector requests are evaluated.
There is a review checklist for maintainers.
There is a clear path from request -> accepted -> connector spec -> implementation.
```

---

# Recommended MVP

For the first pass, only add:

```text
1. service-connector-request.yml
2. labels in the repo
3. short README to-do item
4. docs/service-connector-review.md
```

That is enough to make connector requests structured without building any automation yet.