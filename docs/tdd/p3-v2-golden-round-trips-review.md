# Test Scrutiny Review: `p3-v2-golden-round-trips`

## Verdict

`ACCEPTED FOR IMPLEMENTATION` after one narrow revision.

- Session `bb437bae-0346-4e28-bbbb-171758ece79f` (`claude-sonnet-5`, 73k output over 100 turns, then 5k over 16 for the revision). `is_error: false` both times. 18 permission denials.
- One new file: `tests/p3-v2-golden-round-trips.test.ts`, 55 tests.

Independent RED reproduction: **10 pass / 45 fail**, identical across six consecutive runs both before and after the revision. `bun run verify:static` at **zero errors, 542 warnings, 10 infos** — no drift toward the locked 545/13 ceiling. `bun run typecheck` clean. All fourteen existing locks verify.

RED names seven of the eight findings — V2-01 (7 tests), V2-02 (3), V2-04 (3), V2-06 (12), V2-10 (15), V2-13 (1), V2-14 (2) — plus two for requirement 6's foreign-block rejection. These are real defects with real coverage, not fixtures that pass on arrival.

## Two judgment calls by the author that were better than the brief

**V2-16 retired with evidence.** The brief listed it as a finding to cover. The author verified it does not reproduce in the backend — `cookies` is assigned identically for every feed type in the caster's shared `base` object and survives a full round trip — and located the actual gap in `frontend/src/components/forms/APIForm.tsx`, which has no cookie UI at all. That is Packet 5's territory and outside this slice's owned files. One regression-lock test was kept as evidence.

This is the first slice to retire a finding with proof rather than writing a test that passes on day one and calling it coverage. The brief asked for exactly this and I would rather have seven honest findings than eight, one of which proves nothing.

**V2-14 reframed into a materially worse defect.** The audit described a cookie "shape reduction" — rich cookie metadata being flattened to `{name,value}`. Direct execution showed that does not happen: cookies pass through the caster and normalizer untouched. What the author found instead is a **secret leak**: a new `{type:"protected"}` cookie value is never run through `protectValue`/`encrypt` the way headers and params are, so its plaintext is written straight to the on-disk YAML. The tests assert the real thing.

The author also reported plainly that `verify:static`, `bunx tsc` and `bunx biome` were denied rather than assuming the gate held — the seventh consecutive slice with that denial pattern, and the reason the round-2 item below was a correction rather than a complaint.

## Round 2: the locked static gate

`verify:static` reported **2 errors** against a locked gate of zero, failing two `p1-static-quality-contract` tests. Both were `lint/correctness/noUnsafeOptionalChaining`: a cast that re-dereferenced through `?.` inside an `isProtectedValue` guard.

Fixed as directed, by hoisting rather than silencing:

```ts
const cookieValue = sessionCookie?.value;
expect(isProtectedValue(cookieValue), …).toBe(true);
if (isProtectedValue(cookieValue)) {
    expect((cookieValue as ProtectedValue & { type: "protected" }).value, …).not.toBe("top-secret-cookie");
}
```

Verified independently: zero `biome-ignore` comments in the file, the assertion text and meaning unchanged, and the split still exactly 10 pass / 45 fail — no fixture lost while fixing lint.

## Rulings on the open questions

1. **V2-16 is retired**, per the evidence above. It is recorded as a Packet 5 frontend gap, not a backend defect.
2. **V2-14 is reframed** from a shape reduction to a plaintext-secret leak, and is the more serious finding of the two.
3. The canonical header/cookie wire shape and the V2-06 metadata placement are settled by the fixtures themselves; the implementation follows what the locked tests assert rather than my inventing a shape ahead of them.

## Test correctness checklist

- [x] RED is caused by missing behaviour, not setup failure. Reproduced at 10 pass / 45 fail.
- [x] Every retained finding has at least one failing fixture; the one that did not reproduce was retired with evidence rather than padded.
- [x] Round trips go through a real `yaml.dump`/`yaml.load` cycle, where the losses actually occur.
- [x] Zero errors; warnings and infos held at 542 / 10.
- [x] `bun run typecheck` clean; all fourteen existing locks verify.
- [x] Deterministic across six runs, before and after the revision.
- [x] No `.only` / `.skip` / `.todo`; no `biome-ignore` added.
- [x] Claude changed test files only.

The suite is locked and implementation may begin.
