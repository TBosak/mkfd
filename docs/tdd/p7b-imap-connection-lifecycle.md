# TDD Requirements Brief: `p7b-imap-connection-lifecycle`

> **Revised.** An earlier version of this brief required hoisting and exporting
> `ImapWatcher` so a test could import it. That is impossible by design and the
> brief was wrong. See "The constraint that shapes this slice" below.

## Ownership

- **Roadmap packet and finding IDs:** Packet 7B, "IMAP connection lifecycle — reported bug ([#77](https://github.com/TBosak/mkfd/issues/77))". Follow-on to `p7b-imap-reconnect-policy`, which landed the scheduler but deliberately left it unwired.
- **Production surfaces owned by this slice:** one new module, `node/imap-connection-lifecycle.ts`, plus thin wiring in `node/imap-watch.utility.ts`.
- **Test surfaces the test author may add or edit:** `tests/` only.

## The constraint that shapes this slice

**The IMAP implementation runs as a Node subprocess on purpose.** Bun does not work reliably with the available IMAP modules, so `workers/imap-feed.worker.ts` launches it explicitly:

```ts
spawn({ cmd: ["node", "--experimental-strip-types", "./node/imap-watch.utility.ts", …] })
```

`node/imap-watch.utility.ts` imports `node-imap` at line 4, at module top level. The repository's tests run under **Bun**. Therefore:

- **No Bun test can import `node/imap-watch.utility.ts`.** Doing so would pull `node-imap` into the Bun runtime, which is the exact incompatibility the subprocess exists to avoid.
- Exporting `ImapWatcher` would not help. The import itself is the obstacle, not the class's scope.
- `ImapWatcher` must therefore stay inside `if (import.meta.main)`, and this slice must **not** restructure it.

The way to make this behaviour testable is the same one that worked for the scheduler: move the logic into a module that has **no `node-imap` import**, and leave a thin wiring layer behind. `node/imap-reconnect-policy.ts` already demonstrates this — it lives under `node/` and its 23 tests run happily under Bun, because it imports nothing Node-specific.

## Why this slice exists

`p7b-imap-reconnect-policy` (commit `bbe98ef`) landed `ReconnectScheduler` with 23 locked tests, but **nothing imports it**, so #77 is not yet fixed. This slice adds the connection-lifecycle logic that uses it, and wires both into the watcher.

## Current behavior and RED reason

Four defects, all live in `node/imap-watch.utility.ts`:

- `start()` binds `this.imap.on("close", () => this.reconnect())` **and** `this.imap.on("error", () => this.reconnect())`, and the surrounding `catch` calls `this.reconnect()` a third time. `node-imap` emits both `close` and `error` for one dropped connection, so pending timers multiply every cycle.
- `reconnect()` is `setTimeout(() => this.start(), 10000)` with no stored handle — nothing is cancellable.
- `stop()` calls `this.imap.end()` but leaves timers pending, so a stopped watcher reconnects anyway.
- `start()` re-calls `connect()` on the **same** `Imap` instance without destroying the previous socket. `removeAllListeners` runs only after a successful connect, and only for three events. `setMaxListeners(20)` is present because of the resulting leak.

**RED command:** `bun test tests/p7b-imap-connection-lifecycle.test.ts`
**Expected RED:** the suite fails to resolve `node/imap-connection-lifecycle`, because the module does not exist yet.

**Pre-existing baseline (do not attribute to this slice):** `bun run verify:core` is 1923 pass / 33 fail; lint 534 warnings / 7 infos. The failure count drifts 31–33 across runs because the Windows `EBUSY` teardown in `p3-webhook-event-state` reports 9–11 depending on run context.

## Public surface

The module must not import `node-imap`. It receives a connection through a factory and describes it **structurally** — only the members it actually uses.

```ts
export interface ImapLike {
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
  end(): void;
  destroy?: () => void;
}

export interface ImapConnectionLifecycleOptions {
  createConnection: () => ImapLike;
  onReady: (connection: ImapLike) => void | Promise<void>;
  scheduler: ReconnectScheduler;      // from node/imap-reconnect-policy
  onTerminalFailure?: (attempts: number) => void;
}

export class ImapConnectionLifecycle {
  constructor(options: ImapConnectionLifecycleOptions);
  start(): void;
  stop(): void;
  readonly connectionsOpened: number;
}
```

Assert on observable effects — how many connections were created, whether the old one was ended and its listeners removed, how many reconnects were scheduled — not on private call order.

## Behavioral contract

| ID | Required observable behavior |
|---|---|
| A1 | `start()` creates exactly one connection via `createConnection` and invokes `onReady` once the connection reports `ready`. |
| A2 | A single dropped connection that emits **both** `close` and `error` results in exactly **one** reconnect. This is the #77 defect. |
| A3 | A connection that fails before `ready` — emitting `error` without ever becoming ready — also produces exactly one reconnect. |
| A4 | Before each reconnect opens a new connection, the previous one has its listeners removed and is ended (or destroyed). Sockets must not accumulate. |
| A5 | On a successful reconnect, `onReady` is invoked again for the new connection, and the scheduler's attempt count is reset. |
| A6 | Reconnects are driven through the injected `ReconnectScheduler`, so delay growth, the ceiling, and the attempt bound all come from the locked policy rather than being reimplemented. |

## Invariants and state transitions

| ID | Invariant or transition |
|---|---|
| I1 | At most one connection is live at a time; `connectionsOpened` increases by exactly one per successful reconnect cycle. |
| I2 | `stop()` cancels any pending reconnect and tears down the current connection. After `stop()`, no further `close`/`error` event opens another connection, however many arrive. |
| I3 | Listener registrations do not accumulate across cycles: repeated failure and recovery must not leave handlers attached to discarded connections. |
| I4 | `onReady` is never invoked for a connection that has already been torn down. |

## Errors and boundaries

| ID | Error condition or boundary behavior |
|---|---|
| E1 | When the scheduler reports exhaustion, the lifecycle stops retrying and reports it once through `onTerminalFailure` rather than looping. |
| E2 | A `createConnection` that throws is treated as a failed attempt and goes through the same single-flight reconnect path, not an unhandled rejection. |
| E3 | An `onReady` callback that throws must not prevent teardown or corrupt lifecycle state; a later failure must still reconnect exactly once. |
| E4 | `stop()` before `start()`, and `stop()` called twice, are both safe. |

## Wiring requirements for `node/imap-watch.utility.ts`

The watcher changes are deliberately thin, and must be asserted **structurally** — by reading the file as text, in the manner of `tests/browser-adapter-static-guard.test.ts` — because the module cannot be imported under Bun.

| ID | Required structural property |
|---|---|
| W1 | The file no longer contains the fan-out pair `on("close", …reconnect…)` together with `on("error", …reconnect…)`. |
| W2 | The file no longer contains a bare `setTimeout(… this.start() …)` reconnect whose handle is discarded. |
| W3 | The file imports and uses `ImapConnectionLifecycle`. |
| W4 | `setMaxListeners(20)` is gone — it exists only to mask the listener leak this slice removes. |
| W5 | The static guard must not import the module; it reads the source text. It must also fail loudly if the file is missing or unreadable, so it cannot pass vacuously. |

## Compatibility and migration invariants

All existing watcher behaviour must be preserved: mailbox opening, the startup fetch, new-mail handling, RSS building, `sendFeedReady`, and webhook delivery. `ImapWatcher` stays inside `if (import.meta.main)` and the module must continue to run correctly when spawned as `node --experimental-strip-types ./node/imap-watch.utility.ts`, because that is how every email feed runs.

## Non-goals

- Exporting or hoisting `ImapWatcher`, or otherwise restructuring the `import.meta.main` bootstrap.
- Importing `node-imap` anywhere in the new module or in any test.
- Changing IMAP protocol handling, mailbox selection, fetch logic, feed construction, or webhook delivery.
- Altering `node/imap-reconnect-policy.ts`, which is locked.
- Porting anything to `main`; that is a separate step once this is proven here.
- Spawning a real subprocess or standing up a fake IMAP server.

## Test constraints

- No live third-party services, no real sockets, no `node-imap` import.
- Deterministic fixtures and controlled time/randomness; no real timers and no `Bun.sleep`. Drive the scheduler through its injected `setTimeoutFn`/`clearTimeoutFn`/`random`.
- Assert semantics rather than private call order.
- New required tests must demonstrate RED for the intended reason before implementation.
- The test author may modify only `tests/`.
- Return a compact coverage manifest keyed by the requirement IDs above.

## Acceptance checklist

- [ ] Every required behavior has a meaningful assertion.
- [ ] The #77 multi-event case (A2) is covered directly.
- [ ] Teardown (A4) and listener non-accumulation (I3) are asserted, not assumed.
- [ ] The static guard covers W1–W5 without importing the module.
- [ ] Tests are isolated and deterministic; no real timers, sockets, or `node-imap`.
- [ ] Targeted RED command and expected failure are stated.
