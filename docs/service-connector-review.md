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

```text
needs-triage
  -> accepted
  -> needs-design
  -> ready-for-implementation
  -> in-progress
  -> done
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
