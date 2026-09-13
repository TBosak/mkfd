# TDD Requirements Brief: `p7b-imap-reconnect-policy`

## Ownership

- **Roadmap packet and finding IDs:** Packet 7B, "IMAP connection lifecycle — reported bug ([#77](https://github.com/TBosak/mkfd/issues/77))". Pulled forward ahead of the rest of 7B because it is a live defect with users affected today; it depends on nothing in Packets 4 through 7A.
- **Feature spec and implementation-plan links:** none yet; the roadmap entry is the specification.
- **Production surfaces owned by this slice:** one new module, `node/imap-reconnect-policy.ts`. The wiring in `node/imap-watch.utility.ts` is a follow-on step and is **not** owned here.
- **Test surfaces the test author may add or edit:** `tests/` only.

## Why this is a standalone module

`ImapWatcher` is declared inside a function in `node/imap-watch.utility.ts` and is not exported, so its reconnect behaviour cannot be reached by a test at all today. The same file has also diverged heavily between `main` and `major-revision-0526` (918 insertions / 769 deletions), so a fix written inline would have to be written twice and reconciled.

A separate module with no `node-imap` dependency is therefore both the only testable shape and the only shape that can be shipped byte-identically to both branches. Keep it free of any IMAP, socket, or network type.

## Current behavior and RED reason

Reported in #77: email scraping works when the container starts and then fails permanently with `Timed out while connecting to server`, recovering only on restart. The reporter's workaround is a crontab restart every 30 minutes.

Four defects in `node/imap-watch.utility.ts` combine:

- `start()` registers **both** `imap.on("close", () => this.reconnect())` and `imap.on("error", () => this.reconnect())`. `node-imap` emits both for a single failure, so one dropped connection schedules two reconnects; the surrounding `catch` calls it a third time. Pending timers multiply each cycle — this is the interleaved `Reconnecting in 10s...` flood in the report.
- `reconnect()` keeps no timer handle, so nothing can be cancelled. `stop()` ends the socket but leaves timers pending, and a stopped watcher reconnects anyway.
- `start()` reuses the same `Imap` instance and calls `connect()` again without destroying the previous socket. `removeAllListeners` runs only *after* a successful connect. The existing `setMaxListeners(20)` is evidence the resulting listener leak was raised rather than fixed.
- Fixed 10s delay, no backoff, no jitter, no attempt cap.

Net effect: connections accumulate until the provider's concurrent-connection limit is reached, after which every new connect times out until restart.

**RED command:** `bun test tests/p7b-imap-reconnect-policy.test.ts`
**Expected RED:** the suite fails to import `node/imap-reconnect-policy`, because the module does not exist yet.

**Pre-existing baseline (do not attribute these to this slice):** `bun test tests/` is 1902 pass / 31 fail; lint is 534 warnings / 7 infos.

## Public surface

The module exports a single class. Constructor options carry injectable time and randomness so tests are deterministic; production omits them.

```ts
export interface ReconnectSchedulerOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  random?: () => number;
  onGiveUp?: (attempts: number) => void;
}

export type ScheduleOutcome =
  | { scheduled: true; delayMs: number; attempt: number }
  | { scheduled: false; reason: "already-pending" | "stopped" | "exhausted" };

export class ReconnectScheduler {
  constructor(options: ReconnectSchedulerOptions);
  schedule(run: () => void): ScheduleOutcome;
  onConnected(): void;
  cancel(): void;
  stop(): void;
  readonly pending: boolean;
  readonly attempts: number;
}
```

Do not assert on private fields or internal call order; assert on returned outcomes, on whether the injected `setTimeoutFn`/`clearTimeoutFn` were used, and on whether `run` was invoked.

## Behavioral contract

| ID | Required observable behavior |
|---|---|
| A1 | The first `schedule()` after construction returns `{ scheduled: true, attempt: 1 }` and arranges for `run` to be invoked later, never synchronously. |
| A2 | While a reconnect is pending, further `schedule()` calls return `{ scheduled: false, reason: "already-pending" }` and do **not** arrange an additional invocation. This is the defect in #77: one dropped connection must produce exactly one reconnect no matter how many events report it. |
| A3 | Delay grows with consecutive attempts rather than staying fixed, starting at `baseDelayMs`. |
| A4 | Delay never exceeds `maxDelayMs`, however many attempts occur. |
| A5 | `onConnected()` resets the attempt count, so the next failure starts again at `baseDelayMs` and attempt 1. |
| A6 | After the scheduled `run` fires, the scheduler is no longer pending, so a subsequent failure can schedule again. |
| A7 | Jitter is applied through the injected `random`, and a fixed `random` yields a fully deterministic delay sequence. |

## Invariants and state transitions

| ID | Invariant or transition |
|---|---|
| I1 | At most one pending reconnect exists at any time, across any sequence of `schedule`, `cancel`, `onConnected` and `stop` calls. |
| I2 | `attempts` increases only on a successful `schedule()`, and returns to zero only via `onConnected()`. |
| I3 | `cancel()` clears a pending reconnect through the injected `clearTimeoutFn` and leaves the scheduler reusable: a later `schedule()` succeeds. |
| I4 | `stop()` is terminal. It cancels any pending reconnect, and every later `schedule()` returns `{ scheduled: false, reason: "stopped" }`. A stopped scheduler never invokes `run`. |
| I5 | `stop()` and `cancel()` are idempotent and safe to call when nothing is pending. |

## Errors and boundaries

| ID | Error condition or boundary behavior |
|---|---|
| E1 | Reaching `maxAttempts` is terminal: `schedule()` returns `{ scheduled: false, reason: "exhausted" }` rather than looping forever, and `onGiveUp` is invoked exactly once with the attempt count. |
| E2 | `onConnected()` after exhaustion restores normal operation — the failure was recoverable and the watcher reconnected by other means. |
| E3 | `maxAttempts: 0`, `baseDelayMs: 0`, and `baseDelayMs > maxDelayMs` are each handled with defined, asserted behavior rather than producing `NaN`, a negative delay, or an unbounded loop. |
| E4 | A `run` callback that throws must not corrupt scheduler state: the scheduler is left non-pending and a subsequent `schedule()` still works. |

## Required edge and adversarial cases

- The #77 fan-out shape specifically: three `schedule()` calls arriving back to back for a single failure must produce exactly one timer and one `run`.
- A long failure streak proving A4's ceiling holds and nothing overflows.
- Interleavings: `schedule` → `cancel` → `schedule`; `schedule` → `stop` → `schedule`; `schedule` → `onConnected` → `schedule`.
- Determinism: with a fixed `random`, the full delay sequence is exactly reproducible.

## Compatibility and migration invariants

None. This is a new module with no existing callers and no persisted state. It must not import from `node-imap`, must not open sockets, and must not read configuration or environment.

## Non-goals

- Wiring the scheduler into `ImapWatcher`, destroying sockets, or removing listeners. That is the follow-on step and belongs to the lead after these tests are accepted.
- Exporting `ImapWatcher`, or otherwise restructuring `node/imap-watch.utility.ts`.
- Anything about IMAP protocol behaviour, mailbox state, or feed output.
- Reproducing #77 end to end against a real mail server.

## Test constraints

- No live third-party services.
- Deterministic fixtures and controlled time/randomness: drive time through `setTimeoutFn`/`clearTimeoutFn` and randomness through `random`. Do not use real timers or `Bun.sleep`.
- Assert semantics rather than incidental formatting or private call structure.
- New required tests must demonstrate RED for the intended reason before implementation.
- The test author may modify only `tests/`.
- Return a compact coverage manifest keyed by the requirement IDs above.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] Applicable edge/adversarial cases are covered, including the #77 fan-out.
- [ ] Failure messages identify the violated contract.
- [ ] Tests are isolated and deterministic; no real timers.
- [ ] Targeted RED command and expected failure are stated.
