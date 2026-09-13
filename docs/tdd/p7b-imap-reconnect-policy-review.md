# Review round 1 — `p7b-imap-reconnect-policy`

The suite is close, and the part that matters most is right. I reproduced RED
independently: `bun test tests/p7b-imap-reconnect-policy.test.ts` gives
0 pass / 1 fail / 1 error, failing to resolve `node/imap-reconnect-policy`,
which is the intended reason. No real timers anywhere, time and randomness are
driven entirely through the injected seams, and the `fireOne()` harness that
throws unless exactly one timer is pending is a good structural choice.

The `#77` fan-out case is exactly what was asked for — three `schedule()` calls
for one dropped connection, one timer, one `run`. That single test is the
regression guard for the reported bug.

Two changes needed. Please make **only** these.

---

## 1. I1 has no direct coverage

Every other requirement ID has its own `describe` block. `I1` has none. The
comment at line 30 says the harness "enforces" it, and `fireOne()` does throw
unless exactly one timer is pending — but that is passive: it only checks at the
moments a test happens to call `fireOne()`. Several paths never call it.

The brief states I1 as holding *"across any sequence of `schedule`, `cancel`,
`onConnected` and `stop` calls"*, and no test drives a mixed sequence. A future
implementation could, for example, leave a stale timer behind on `cancel()`
followed by `schedule()` and still pass everything currently written.

Add an `I1` block that runs a mixed interleaving — something like
`schedule → cancel → schedule → onConnected → schedule → stop` — and asserts
`pendingCount <= 1` after **every** step, not only at the end. Keep using the
existing harness rather than adding a second one.

## 2. Four new `noNonNullAssertion` warnings — the budget is zero

`bunx biome lint` on this file reports 4 warnings, all `lint/style/noNonNullAssertion`:

| Line | Expression |
|---|---|
| 37 | `const [id, fn] = [...timers.entries()][0]!;` |
| 151 | `expect(delays[i]!).toBeLessThan(delays[i + 1]!);` (two) |
| 250 | `const v = values[counter % values.length]!;` |

Project lint went 534 → 538 warnings. That still sits under the locked 545/13
ceiling and the anti-bypass gate passes, so nothing is broken — but the standing
rule for new test files is **zero** new findings, and three previous slices have
eaten into that ceiling exactly this way. The margin is now 7.

None of these need an assertion:

- **37** — you have already proven `timers.size === 1` on the line above, so
  destructure without the `!`, or read the entry into a local and narrow it.
- **151** — iterate over pairs instead of indexing, or capture
  `const current = delays[i]; const next = delays[i + 1];` and assert both are
  defined as part of the test's own contract.
- **250** — `values.length` is known non-zero at construction; hoist a
  non-empty local or use a small helper that returns a `number`.

Please also apply the formatter's import ordering ("Sort these imports"); it is
not lint-gated but it is one command.

---

## Not changing

The overall shape, the harness design, the fan-out test, the E3 boundary cases
(`maxAttempts: 0`, `baseDelayMs: 0`, `baseDelayMs > maxDelayMs`), and the E4
throwing-callback case all stand as authored. Do not restructure them.

---

# Acceptance — round 1 accepted

**Verdict: accepted.** Locked 2026-09-13.

Session `f3aea8c3-4c71-492b-b798-0b616a324b44` (`claude-sonnet-5`), author pass
34 turns, revise pass 20 turns, both in the same session. The launcher did not
throw on either pass, so no state reconstruction was needed.

**Provider pairing: degraded (rung 2).** Codex was out of usage, so Claude Opus
led and Claude Sonnet 5 authored — same provider in both seats, different
sessions. Role separation held, but this slice received a weaker adversarial
pass than a cross-provider split would have given. Recorded per the staffing
ladder in `AGENTS.md`.

## Both requested changes verified by the lead, not taken on report

| Change | Verification |
|---|---|
| `I1` direct coverage | New block at line 287 drives `schedule → schedule → cancel → schedule → onConnected → schedule → stop → schedule` and asserts `pendingCount <= 1` after **every** step, with exact assertions at the meaningful points (1 after the first schedule, 0 after `cancel`, 0 after `stop`). |
| Zero new lint findings | `bunx biome lint` on the file: clean. Full `bun run lint`: **534 warnings / 7 infos** — exactly the pre-slice baseline, so the 545/13 ceiling margin is restored to 11. |

**RED reproduced independently after the revision:** 0 pass / 1 fail / 1 error,
failing to resolve `node/imap-reconnect-policy`. That is the intended reason —
the module does not exist yet.

## What the suite pins

The regression guard for #77 is the fan-out case: three `schedule()` calls
arriving back to back for one dropped connection produce exactly one timer and
one `run`. That is the precise defect reported — `node-imap` emits both `close`
and `error` for a single failure, and the surrounding `catch` adds a third call,
so the old code multiplied pending timers every cycle.

Beyond it: delay growth with a hard ceiling, `onConnected` resetting the attempt
count, `cancel` leaving the scheduler reusable, `stop` being terminal, bounded
attempts with a single `onGiveUp`, and the boundary configurations
(`maxAttempts: 0`, `baseDelayMs: 0`, `baseDelayMs > maxDelayMs`) each having
defined asserted behaviour rather than `NaN` or an unbounded loop.

No real timers anywhere; the fake-timer harness throws unless exactly one timer
is pending, which makes I1 hard to violate accidentally even outside its own
test.
