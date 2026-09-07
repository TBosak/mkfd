# Test Scrutiny Review (round 2 delta): `p3-v2-golden-round-trips`

The suite is accepted in substance. One mechanical thing blocks the lock, and it is the same class of breach as two earlier slices.

## What is already right

Independent RED reproduction: **10 pass / 45 fail** in `tests/p3-v2-golden-round-trips.test.ts`, identical across six consecutive runs. `bun run typecheck` clean. Warnings held at exactly **542 / 10** — no drift toward the locked 545/13 ceiling. All fourteen existing locks verify.

The RED failures name seven of the eight findings — V2-01 (7), V2-02 (3), V2-04 (3), V2-06 (12), V2-10 (15), V2-13 (1), V2-14 (2) — plus two for requirement 6's foreign-block rejection. That is real coverage of real defects, not fixtures that pass on arrival.

Two things I want to credit specifically, because both are the behaviour the brief asked for and neither was the easy option:

- **V2-16 retired with evidence.** You verified it does not reproduce in the backend: `cookies` is assigned identically for every feed type in the caster's shared `base`, and survives the round trip. The real gap is that `frontend/src/components/forms/APIForm.tsx` has no cookie UI, which is Packet 5's territory and outside this slice's owned files. Keeping one regression-lock test as evidence is exactly right. Retiring a finding with proof is worth more than carrying a hollow test that passes on day one, and this is the first time a slice has done it.
- **V2-14 reframed into something worse.** The audit described a shape reduction; you found by direct execution that cookies pass through untouched, and that the actual defect is a **secret leak** — a new `{type:"protected"}` cookie value is never run through `protectValue`/`encrypt` the way headers and params are, so its plaintext is written straight to the on-disk YAML. That is a materially more serious finding than the one you were handed, and the tests assert the real thing.

You also reported plainly that `verify:static`, `bunx tsc` and `bunx biome` were denied rather than assuming the gate held. That is what I asked for, and it is why the item below is a correction rather than a complaint.

## The blocker: two error-level lint diagnostics

`bun run verify:static` now reports **2 errors**, against a locked gate of zero. Warnings and infos are fine; it is the error count that breaks it, and it fails the locked `p1-static-quality-contract` tests:

- `root aggregate 'bun run lint' exits zero with no error-level diagnostics (requirement 1)`
- `root and frontend lint halves individually reach zero errors`

Both errors are `lint/correctness/noUnsafeOptionalChaining`, at lines 495 and 535:

```ts
if (isProtectedValue(sessionCookie?.value)) {
    expect((sessionCookie?.value as ProtectedValue & { type: "protected" }).value, …)
```

The guard above proves the value is present, but the cast re-derefences through `?.` and Biome flags the pattern regardless of the guard.

- Required correction: hoist the value into a local after the optional access, then guard and assert on the local — `const cookieValue = sessionCookie?.value; if (isProtectedValue(cookieValue)) { … }`. The assertion keeps its exact meaning; only the dereference changes. Do not silence the rule with an ignore comment, and do not weaken the assertion to dodge it.

Nothing else changes. Every fixture, every finding, and the V2-16 and V2-14 rulings stand as they are.

## Verification

Change only `tests/p3-v2-golden-round-trips.test.ts`. Then:

```
bun run verify:static
bun test tests/p3-v2-golden-round-trips.test.ts
```

`verify:static` must read **zero errors**, with warnings and infos at or below **542 / 10**. The suite must still be **10 pass / 45 fail** — the same split, with no fixture lost while fixing the lint. Run it 6 times and confirm the split is identical each time. If `verify:static` is denied again, say so and I will run it.
