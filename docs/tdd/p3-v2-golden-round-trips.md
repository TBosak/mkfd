# TDD Requirements Brief: `p3-v2-golden-round-trips`

## Ownership

- Roadmap packet and findings: Packet 3, "finish strict per-type validation… treat the V2-01/02/04/06/10/13/14/16 golden round trips as contract tests".
- Production surfaces owned by this slice: `utilities/feed-config-caster.utility.ts`, `utilities/feed-config-normalizer.utility.ts`, `utilities/feed-config-validator.utility.ts`, and `models/feed-config.model.ts` where a canonical field is missing.
- Explicitly NOT in this slice: the frontend `configToFormData` converter and the builder forms. The roadmap assigns those halves to Packet 5, and `tests/configToFormData.test.ts` is locked under `workflow-smoke`. This slice owns the **backend** round trip only.
- Do not touch the outbound executor (`utilities/outbound-fetch-policy.utility.ts`, `utilities/feed-config-route-adapter.utility.ts`, `utilities/fetch-policy.utility.ts`, `lib/outbound/*`) — frozen contract, nine locked files. The source-definition registry from the previous slice (`utilities/feed-source-registry.utility.ts`) may be *read* and extended with declarations, but its five test files are locked.
- Claude-owned test surfaces: `tests/` only.

## Current RED baseline

`bun run verify:core` = **1600 pass / 0 fail** at commit `d1c490a`. `bun run test:e2e` = **56 passed / 8 skipped / 0 failed**. Fourteen test locks verify.

Static gate: **zero errors, 542 warnings, 10 infos**, against a locked ceiling of 545/13. Stay at or below 542/10 — the gap is not budget. Note the locked anti-bypass test also counts `noExplicitAny` and `noNonNullAssertion` specifically and refuses growth; it caught a single added `any` last slice.

### The defect class

Every finding here is the same shape: **editing and saving a feed destroys data that the runtime still supports**. Not a crash, not a rejection — a silent loss discovered later when the feed stops behaving as it did.

Two I verified directly in the code rather than taking from the audit:

- **V2-13** — `utilities/feed-config-caster.utility.ts:106` writes `enabled: true` unconditionally. Editing a disabled feed re-enables it.
- **V2-04** — the webhook block in the caster emits `url`, `format` and `newItemsOnly` only. `headers` and `customPayload` are read by the form and dropped on save.

The remaining six are from the audit and you should verify each before writing its test, the same way — if one turns out to be already fixed, say so rather than writing a test that passes immediately and calling it coverage:

- **V2-01** (blocker) — `buildCSSTargetFromForm` drops `drillChain`, `iterator` and GUID permalink state, which the RSS runtime still honours. Parallel iterators and per-field drill chains are supported v2 features.
- **V2-02** (blocker) — common headers are corrupted on edit: the converter emits `[{key,value}]` while the caster treats that array as a record, writing keys like `"0"` instead of the header name. Protected/env values also flatten back to plain strings.
- **V2-06** — feed-level RSS metadata (language, copyright, managing editor, webmaster, categories, TTL, skip hours/days, image, `feedDocs`, `feedGenerator`, description) is lost or reset on edit.
- **V2-10** — REST/API mapping drops `guidIsPermaLink`, `feedLinkPath`, `feedLastBuildDatePath`, and writes legacy flattened keys where the runtime reads nested canonical ones.
- **V2-14** — the rich cookie model (protected/env values, domain/path/secure/httpOnly) is reduced to v2 `{name,value}` strings.
- **V2-16** — API feeds lost the cookie input entirely, though the API worker still reads common cookies.

## Required observable behavior

1. **A config survives `cast → yaml → normalize` byte-for-byte in meaning.** For each finding above, a golden fixture carrying the at-risk fields must come back with those fields intact. Assert on the *values*, not on the presence of a key.
2. **`enabled` is preserved, not asserted.** A disabled feed edited and saved stays disabled; an enabled one stays enabled. Both directions.
3. **Protected and env values survive the round trip as themselves.** A `{ type: "protected" }` value must not come back a plain string, an env-backed value must not lose its variable name, and a masked value must not overwrite the stored ciphertext. This is the property `p2-protected-value-aes-gcm` established; a round trip that flattens it undoes that slice.
4. **Rich cookies and headers keep their shape.** Domain, path, secure and httpOnly survive; a header named `Authorization` does not become a key named `"0"`. Cover the legacy `[{key,value}]` form migrating losslessly to the canonical shape, since old configs on disk carry it.
5. **CSS targets survive whole.** Every `CSSTarget` property, including `drillChain`, `iterator`, and GUID permalink semantics, across every article field — not just the first one.
6. **Strict per-type validation rejects irrelevant and unsafe fields.** A config carrying a block belonging to another source type must be refused, not silently persisted. Prove the refusal names the offending field.
7. **Only the current schema is written.** A legacy config read and re-saved must emit canonical field names, while a legacy config merely *read* must still resolve. Both halves matter: the normalizer's job is to keep old YAML working, and the caster's is to stop writing more of it.
8. **Every source type still round-trips.** Table-driven across all twelve, so a regression names the type. `changeDetection` is a registered stub (`implemented: false`) — assert it round-trips as a stub rather than pretending it has a config.

## Anti-bypass and adversarial requirements

- Do not fix a round trip by widening a type to `any` or by adding a non-null assertion; the anti-bypass gate counts both and will fail.
- Do not make a test pass by deleting the field from the model. Every field named above is a supported runtime capability.
- Do not change the on-disk YAML shape of existing configs. Old files must keep loading; that is what the normalizer is for.
- A fixture that only exercises fields the caster already handles is not coverage. Each golden fixture must fail before the fix.
- Do not weaken the validator's existing rejection of unknown `feedType`.
- Do not edit the frontend converter or its locked test to make a backend round trip pass.
- **Run `bun run verify:static` before reporting.** It has been denied on six consecutive slices; if denied again, say so explicitly rather than assuming the ceiling holds.
- Run each new test file 6-8 times and confirm the split is identical.

## Test-author expectations

- Golden fixtures as real config objects in `tests/`, one per finding, named so a failure identifies the finding (`V2-04`, `V2-13`, …).
- Drive the real `castFeedFormDataToFeedConfig` and `normalizeLoadedFeedConfig` entry points through an actual `yaml.dump`/`yaml.load` cycle, as the existing `feed-config-type-compatibility` suite does — a round trip that skips serialization would miss exactly the losses that happen there.
- Where a finding spans several fields, prefer one test per field over one test asserting a whole object, so a partial regression names what broke.

## Notes and open questions for the lead

Flag rather than guess:

- Whether any of the six unverified findings is already fixed. Report what you find; I would rather retire a finding with evidence than carry a test that proves nothing.
- Whether the canonical header/cookie wire shape should be the rich object model everywhere, or the legacy form should remain accepted on read only. State what your tests assume.
- Whether `feedDocs`/`feedGenerator` and the other V2-06 metadata belong on `FeedConfigBase` or in a nested metadata block. If the model needs a new field, name it rather than stuffing values into an existing catch-all.
