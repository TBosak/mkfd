# Review round 1 — `p3-browser-adapter`

The suite is accepted on substance. I reproduced RED independently and got
0/1+error, 4/10, 3/3, 2/4, 1/1 across the five files, which matches your report.
No real Chromium is launched; the `mock.module("patchright")` and injected-factory
split is the right technique. The credential-non-leak assertion, the allowlist
override, the once-per-navigation logging bound, the close-exactly-once and
idempotent-close cases, and the deliberate separation of "networkidle timed out"
from "policy refused" are all good, and several go past what the brief asked for.

Two things need fixing before I can lock it. Please make **only** these changes.

---

## 1. Eight lint errors — the ceiling requires zero

You flagged that the sandbox refused you `bun run lint` / `biome`. I ran it:

```
bunx biome check <the 7 files>
Checked 7 files in 22ms. Found 8 errors.
```

All eight are mechanical — six "Formatter would have printed the following
content" plus "Sort the imported names" and "Sort these imports". None is a
semantic defect. But the project gate demands **zero errors**, and this is the
fourth consecutive slice where the sandbox denied you lint and the lead found
breaches afterwards, so please fix them at the source rather than leaving them
for me.

Run `bunx biome check --write` on the seven files if that is permitted; if it is
still denied, fix by hand:
- sort the named imports inside the offending `import { … }` (Biome wants them
  alphabetical — e.g. `readFileSync` before `readdirSync` per its ordering), and
- sort the import statements themselves,
- and apply the formatter's line-wrapping to the long `expect(...)` calls.

I will re-run the check before locking, so please confirm in your report that
`bunx biome check` is clean, or say plainly that you could not run it again.

## 2. The static guard can pass vacuously

`scanForHits()` in `tests/browser-adapter-static-guard.test.ts` returns `[]` both
when the code is clean **and** when it walked nothing at all. `listTsFiles`
swallows a failed `readdirSync` and returns `[]`:

```ts
try { entries = readdirSync(dir); } catch { return out; }
```

So a renamed directory, a different working directory, or a path-separator
problem on the other OS turns the strongest assertion in this slice into a test
that passes while proving nothing — permanently and silently, because a green
guard invites nobody to look. The project has already been bitten by this exact
class: the locked architecture ledger carries an explicit non-vacuity check for
the same reason (see CF-13 in `docs/mkfd-v3-implementation-ledger.md`).

Please add a non-vacuity assertion: prove the scan actually walked a plausible
number of files, and that it reached each of the four scanned directories. A
count threshold plus a per-directory "found at least one `.ts` file" check is
enough. It must fail loudly if the walk comes back empty.

While you are in that file, the `describe` title and the comment above
`KNOWN_CALL_SITE_FILES` both say "the four named call-site files" while the array
holds three paths — `data-handler.utility.ts` carries two of the four *sites* but
is one *file*. Reword to match; the list itself is correct.

---

## Rulings on the two questions you raised

**The `_launchBrowser` hook on `BrowserFetchRequest` is accepted.** It mirrors the
established `_dnsLookupFn` / `_skipDns` convention on `OutboundFetchPolicyOptions`,
so it is a project idiom rather than a new one, and the adapter's own suite needs
per-test control that module mocking cannot give cleanly. Keep it.

**The drill-chain cookie gap stays out of scope — do not add a test for it.** You
are right that `resolveDrillChain`'s advanced branch ignores `cookies` while the
preview and worker branches apply them, and you were right to flag it rather than
quietly fix it. But making the drill chain start sending cookies would change what
requests real feeds emit — a behaviour change beyond a migration slice, and one
that could send a user's session cookie to a host it has never been sent to
before. I am recording it as a carried finding in the ledger instead. Leave the
current behaviour exactly as it is.

Everything else stands as authored.
