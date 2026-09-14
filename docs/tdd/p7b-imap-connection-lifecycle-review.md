# Acceptance — `p7b-imap-connection-lifecycle`

**Verdict: accepted on the first round.** Locked 2026-09-13.

Session `399e1ee8-0e95-481d-9270-8e2dfbf3c683` (`claude-sonnet-5`), 17 turns.
The launcher did not throw, so no state reconstruction was needed.

**Provider pairing: degraded (rung 2).** Codex out of usage, so Claude Opus led
and Claude Sonnet 5 authored — same provider, different sessions. Role
separation held; the adversarial pass is weaker than a cross-provider split.

## A corrected brief

The first version of this brief required hoisting and exporting `ImapWatcher`
so a test could import it. That is impossible by design: the IMAP implementation
runs as a Node subprocess precisely because Bun does not work with `node-imap`,
`node/imap-watch.utility.ts` imports it at module top level, and the tests run
under Bun. Exporting the class would not have helped — the import is the
obstacle, not the scope.

The brief was rewritten around the constraint: put the logic in a module with no
`node-imap` import and prove the thin wiring structurally. The first author run
died on a session limit having written nothing, so no work was lost to the
mistake.

## Verified by the lead, not taken on report

| Check | Result |
|---|---|
| RED | 0 pass / 1 fail / 1 error — cannot resolve `node/imap-connection-lifecycle`. Intended reason. |
| `bunx biome lint` on the suite | clean |
| Full `bun run lint` | 534 warnings / 7 infos — exactly the pre-slice baseline |
| `node-imap` imported? | No. Only in comments explaining why it must not be. |
| Real timers or sockets? | None. Time runs through the scheduler's injected seams; the connection is a hand-rolled fake. |

## What the suite pins

**A2 — the #77 fan-out, covered in all three shapes:** `close` then `error`,
`error` then `close`, and both fired before `ready`. Each must collapse to
exactly one pending timer and one new connection. That is the reported defect
stated three ways, which matters because `node-imap` does not guarantee the
order.

**I3 — listener non-accumulation** loops three full failure/recovery cycles and
asserts `hasListeners === false` on each discarded connection, then adds the
case I would have asked for if it were missing: a late event arriving on an
already-discarded connection must not trigger another reconnect.

**W1–W5 — the wiring guard** reads `node/imap-watch.utility.ts` as text rather
than importing it, following `browser-adapter-static-guard`. Two details make it
worth keeping:

- W5 proves non-vacuity directly — it asserts that reading a *missing* path
  throws, so the guard cannot pass silently if the file moves or is unreadable.
- W3 asserts the watcher actually constructs `ImapConnectionLifecycle`, not
  merely that the identifier appears in an import.

No revision was requested.
