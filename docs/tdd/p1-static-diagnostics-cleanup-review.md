# Test Scrutiny Review: `p1-static-diagnostics-cleanup`

## Verdict

`RETURN TO CLAUDE`

The first draft provides a meaningful RED (297 pass / 14 fail) and useful real-command, accessibility, hook, regex, and protected-value guards. The following material gaps must be closed before implementation.

## Biome anti-bypass gaps

### Partial group downgrade still hides errors

`isGroupDisabled` treats `{ "recommended": false, "noSvgWithoutTitle": "error" }` as safe. That configuration implicitly disables the rest of the group's recommended rules, including current error rules. Bare group levels `"warn"` and `"info"` are also accepted.

- Counterexample: set `a11y.recommended=false`, re-enable only `noSvgWithoutTitle`, and fix/avoid that one rule. Button, label, and keyboard errors disappear while all current tests pass.
- Required assertion: reject `recommended:false`, `off`, `warn`, or `info` for any current error-producing group unless every current error-producing rule in that group is explicitly retained at error. The simpler and preferred contract for this slice is to reject all such group downgrades.

### File-specific exclusions are only sampled

The 16 known-erroring files are a useful probe, but another current erroring source can be individually negated and hidden.

- Counterexample: add a negated `files.includes` entry for an erroring file not in the sample (for example another feed component), then fix the sampled files.
- Required assertion: allowlist the existing approved negated generated/reference/runtime paths in both configs and reject any new source-path negation, or dynamically compare the real verbose processed set with the applicable discovered root/frontend source set. Preserve the approved exclusions from the preceding slice.

### Ambient any-shims are not blocked

The compiler can be made green with local `declare module "minimist";` / `declare module "js-yaml";` style shims. These use implicit `any`, do not increase the explicit-any counter, and are contrary to the maintained-declaration-package requirement.

- Required assertion: reject new ambient module declarations for the currently missing third-party declarations (and wildcard declarations). Maintained package declarations or properly typed narrow adapters remain valid.

## Accessibility semantics gaps

### Labels do not prove a matching control

`isLabelWithoutValidAssociation` accepts any nonempty `htmlFor`, even when no element has a matching `id`.

- Counterexample: `<label htmlFor="typo">Name</label><input id="actual" />` passes.
- Required assertion: within the relevant JSX source/tree, literal `htmlFor` must match a literal control `id`; wrapped native controls remain valid. Add helper fixtures for matching and mismatching IDs.

### Keyboard behavior is presence-only

The clickable-static-element predicate accepts `role="presentation"`, `tabIndex={-1}`, and an empty `onKeyDown={() => {}}`.

- Required assertion: require an appropriate interactive role, keyboard-reachable tab index, and a handler that activates for Enter and Space (or invokes the same activation callback through an equivalent helper). Add adversarial fixtures for wrong role, negative tab index, and inert key handler. A native button conversion remains the preferred valid implementation.

### `aria-labelledby` references are not validated

Any nonempty `aria-labelledby` passes even if no descendant/related node has that ID.

- Required assertion: literal `aria-labelledby` references must resolve to a nonempty titled/labelling element in the same inline SVG. Dynamic expressions may be handled conservatively, but a broken literal reference must fail.

## Hook guard correctness

The hook guard claims module-scope functions are stable, but `isPlainFunctionDeclared` searches the whole file without checking scope and flags module-scope declarations too.

- Counterexample: a valid `function loadOnce()` declared at module scope and used in `[loadOnce]` fails the test suite, forcing an unnecessary `useCallback` or inline rewrite.
- Required correction: distinguish component-local functions from module-scope stable declarations (prefer symbol/scope-aware analysis), and add a module-scope helper fixture. Also avoid treating a same-named `useCallback` in a different scope as stabilizing an unrelated local function.

## Protected-value boundary gap

The compiler guard only catches `ProtectedValue as string`. A current diagnostic already involves a container cast from `Record<string, ProtectedValue>` to `Record<string, string>`, which the test does not detect.

- Required assertion: detect direct and nested/container plaintext casts where a source type contains `ProtectedValue`/`ProtectedRecord` and the asserted target is `string` or a string-valued container. Cover `Record<string, ProtectedValue> as Record<string, string>` and the double-cast variant in helper fixtures. The existing global double-cast ceiling is not sufficient because another occurrence could be removed to offset a new dangerous cast.

## Missing behavior-preservation case

Claude reported that the `ABS_URL_RE.exec` loop feeding `nextUsefulAbs` was untested. It is reachable through exported `discoverUrl`.

- Required scenario: construct a Cheerio target whose earlier discovery branches do not yield a URL, whose serialized HTML contains one or more boring absolute URLs followed by a useful URL, and assert `discoverUrl` returns the first non-boring useful URL. Include a no-useful-URL case. This protects the assignment-loop rewrite without exporting a private helper.

## Repetition and runtime efficiency

Cache identical real-command probes within the test process. The architecture suite currently runs aggregate lint repeatedly for exit/count/warning/info assertions, and each known-file inclusion test spawns Biome twice. Reuse one result per unique command/path/config while preserving independent assertions. Do not weaken the observable checks.

## Feedback for Claude

Revise the same six test files to close every gap above. Change tests only. Run the new six files plus the four accepted static/E2E architecture files; do not run the full filesystem-mutating suite. Report the revised RED breakdown and any genuine remaining limitation.

## Round 2 scrutiny

`RETURN TO CLAUDE`

The first revision independently reproduces the intended 336-pass / 15-fail RED state, and it closes the original Biome, hook-scope, protected-container-cast, URL-loop, and command-caching gaps. Two accessibility predicates still admit semantically invalid fixes, so the suite is not ready to lock.

### A label can match a non-control or unrelated component ID

`collectDeclaredIds` records every literal `id` anywhere in the source file, and `isLabelWithoutValidAssociation` accepts any matching value. This does not prove that `htmlFor` targets a labelable control, and file-wide matching lets an ID in a different component declaration satisfy the label.

- Counterexample 1: `<><label htmlFor="panel">Name</label><div id="panel" /></>` passes even though the target is not labelable.
- Counterexample 2: two components in one file, where the label is in one component and a matching input ID appears only in the other, pass despite never rendering an association together.
- Required correction: resolve literal `htmlFor` to a literal ID on a labelable native control (or a deliberately supported custom-control contract) within the relevant component/JSX ownership tree. Keep the valid sibling-control case. Add both counterexamples as helper fixtures.

### Non-interactive ARIA roles are accepted as interactive

`hasAppropriateInteractiveRole` rejects only `presentation`, `none`, and the empty string. Consequently `role="img"`, `role="heading"`, `role="status"`, or any typo passes if `tabIndex` and a key handler are present.

- Counterexample: `<div role="img" tabIndex={0} onClick={activate} onKeyDown={activate}>...</div>` passes.
- Required correction: literal roles must be drawn from an explicit interactive-role allowlist appropriate for click activation (for example `button`, `link`, `checkbox`, `radio`, `switch`, `tab`, `menuitem`, or another defensible interactive role). Dynamic roles may remain conservative. Add fixtures proving an interactive role passes and `img`/another non-interactive role fails.

### Small explicit-type edge case

The button predicate checks only attribute presence, so `<button type="">` passes despite having no valid button type.

- Required correction: reject an empty literal `type`; accept the standard literal values (`button`, `submit`, `reset`) and conservatively accept a dynamic expression. Add helper fixtures for empty and valid values.

Revise tests only in the same authoring session. Preserve the independently confirmed 15 genuine RED failures unless a newly strengthened semantic guard exposes an additional real production violation. Re-run the same ten-file targeted command and report the breakdown.

## Round 3 scrutiny

`RETURN TO CLAUDE`

Round 2 closes its assigned false-green paths, but final source inspection found two material coverage gaps and one standards-completeness issue.

### A native SVG `<title>` is wrongly rejected

`isSvgWithoutAccessibleNameOrHiddenState` recognizes `aria-label`, a resolved `aria-labelledby`, or `aria-hidden`, but not a direct nonempty `<title>` child. A native SVG `<title>` is itself a standard accessible-name mechanism; requiring an additional `aria-labelledby` would overconstrain a valid semantic fix.

- Counterexample: `<svg><title>GraphQL</title><path /></svg>` is valid but currently fails the helper.
- Required correction: accept a direct/appropriate nonempty `<title>` child as an accessible name. Keep rejecting an empty `<title>`.
- Also handle a whitespace-separated literal `aria-labelledby` token list without treating the entire string as one ID. At least one nonempty resolved labelling reference should provide a name; add a fixture with `aria-labelledby="title description"`.

### `@ts-expect-error` can bypass compiler failures

The anti-bypass suite rejects `@ts-ignore` and `@ts-nocheck`, but a production fix could place `@ts-expect-error` before each existing strict diagnostic and make typecheck green without increasing any current unsafe-escape counter.

- Required assertion: production-source `@ts-expect-error` count must remain at its authoring baseline (expected zero; verify it). Add it alongside the existing TypeScript suppression guards.

### Native labelable elements are incomplete

`NATIVE_LABELABLE_CONTROLS` contains only `input`, `select`, and `textarea`. The standard native labelable set also includes `button`, `meter`, `output`, and `progress` (with the usual hidden-input caveat). Omitting these can reject a valid future semantic repair and contradicts the helper's claim to recognize native labelable controls.

- Required correction: cover the standard native labelable elements, and add at least one non-input fixture (for example a matching sibling `output` or a wrapped `meter`) so the expanded contract is exercised. A literal hidden input must not be used as the positive fixture.

Revise tests only in the same session, retain all earlier adversarial fixtures, and run the same ten-file targeted command. If the same 15 genuine RED failures remain, report that result for final acceptance.

## Final acceptance

`ACCEPTED`

- Claude Code Sonnet 5 session: `801db20e-5c32-44bd-a095-a77a7184ef7f`.
- Independent Codex command: the same ten-file targeted suite specified above.
- Independent result: 354 pass / 15 fail / 369 tests / 708 assertions.
- All 15 failures are genuine production REDs: four frontend semantic scan failures, two raw SVG title failures, one protected-value container-cast failure, six lint/typecheck command-contract failures, and two Tailwind CSS parse/lint failures.
- The six Claude-owned test files are accepted without Codex modification and are ready to lock.

## Implementation verification

`GREEN`

- Accepted test hashes were locked before production changes and verified unchanged afterward, together with both earlier Packet 1 locks.
- The same ten-file acceptance command completed with 369 pass / 0 fail / 714 assertions.
- Aggregate root/frontend lint and all typecheck entry points exit zero. The accepted warning ceiling remains exactly 545 warnings / 13 infos, with no new unsafe escapes or suppression directives.
- A focused regression run covering protected values, config casting/normalization, request profiles, RSS/normalized output, email-worker messaging, templates, JSON-LD, form requests, history, and the Community Catalog completed with 133 pass / 0 fail.
- `bun run build` completed successfully. Vite retains its existing advisory that the main bundle exceeds 500 kB; Packet 4 owns route-level code splitting.
