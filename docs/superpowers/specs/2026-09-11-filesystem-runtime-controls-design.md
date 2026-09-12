# Filesystem Runtime Controls — Design Addendum

**Date:** 2026-09-11
**Status:** Approved
**Authority:** Mkfd v3 roadmap Packet 3 and Packet 7B; audit S6/S9

## Relationship to the original filesystem spec

This addendum supersedes the runtime-state and path-security portions of
`2026-05-24-filesystem-design.md`. YAML remains configuration authority, but
filesystem observation state now belongs in the managed runtime SQLite
database rather than `feed-state/filesystem/*.json`. The original product
mapping, polling, glob, sidecar, and extraction behavior remains in force
inside the hard limits below.

## Security and resource contract

- Configured scan roots are authorized both when a config is saved and when it
  runs. Authorization compares canonical existing directories against the
  canonical deployment roots from `FILESYSTEM_FEEDS_ROOTS` or
  `FILESYSTEM_FEEDS_ROOT`; lexical prefix checks alone are insufficient.
- A scan never follows a symbolic link or junction. Every traversed directory
  and opened file is re-authorized after resolution, and file reads use a
  no-follow/open-handle boundary where the platform provides one. A path swap
  must fail closed rather than reading outside an approved root.
- One scan is bounded to 32 directory levels, 10,000 visited directory entries,
  10,000 matched files, 64 MiB of total file/sidecar bytes read, and 30 seconds
  of controlled elapsed time.
- One sidecar is at most 64 KiB, 8 object/array levels, and 1,024 contained
  keys/array elements. It must be a JSON object and may not contain prototype
  mutation keys. Malformed or over-limit sidecars are skipped with a sanitized
  warning, preserving the existing best-effort sidecar contract without reading
  beyond the byte ceiling.
- One content-hash or extraction read is at most 5 MiB. Extracted output is at
  most 20,000 characters. Configured lower limits remain effective; config
  values cannot raise these ceilings.
- `maxItems` is a positive integer clamped to 10,000. Include and exclude lists
  have at most 100 non-empty patterns each, with each UTF-8 pattern at most 256
  bytes. Invalid numeric or pattern values fail validation instead of creating
  an unbounded path.
- A traversal resource, authorization, race, cancellation, or unsafe I/O failure aborts the scan
  with a stable sanitized error code and safe counts only. Submitted paths,
  sidecar contents, filesystem errors, and host paths are not reflected.

## Durable state contract

- A managed Drizzle migration stores per-feed relative path, stable ID,
  first/last-seen times, last modified time, size, and optional content hash.
- State for a completed scan is committed transactionally. New observations,
  updates, and removal of disappeared files become visible together.
- A bounded/failed/cancelled scan commits no observation changes and is never
  labeled complete. Existing SQLite state remains usable after restart.
- The legacy JSON state file is copied forward idempotently on first use, with
  valid records preserved and malformed/unsafe records skipped. The source file
  remains recoverable and SQLite wins conflicts.

## Compatibility

- Valid existing filesystem configs and item mapping remain equivalent within
  the limits. Empty include means include all; exclude wins; relative item paths
  use `/`; symlinks stay excluded; configured sort/date/GUID/title/description
  strategies retain their documented behavior.
- `firstSeenAt` and `firstSeenId` survive migration and process restart.
- Preview and scheduled execution use the same bounded scanner and state API.
- Public file serving and builder UI are outside this Packet 3 hardening slice;
  their later implementation must reuse the same canonical authorization
  boundary.

## Acceptance

Real temporary-directory tests exercise exact/over limits, canonical-root
escape, symlinks, a simulated path swap, controlled timeout/cancellation,
sidecar and extraction bounds, transactional rollback, concurrent scans,
restart, and legacy copy-forward without touching repository runtime state.
