# UI Redesign Correction Pass — Implementation Plan

**Spec:** `../specs/2026-09-02-ui-redesign-correction-pass-design.md`  
**Roadmap:** Packet 4

## Order of work

1. Freeze the shared frontend source registry and token/component contracts after Packet 3 freezes backend capabilities.
2. Correct app-shell navigation, document titles, skip link, responsive reachability, and focus placement.
3. Reconcile shared fields, dialogs, menus, toasts, error/loading/empty states, motion, and semantic tokens.
4. Repair My Feeds actions and accessible detail presentation without editing builder high-churn files concurrently.
5. Remove superseded CSS/components only after usage and visual-regression checks prove they are dead.
6. Add route splitting, bundle budgets, 390 px scenarios, keyboard scenarios, and representative axe checks.

## Verification

- Claude Sonnet 5 authors tests for each independently verifiable slice.
- `bun run verify:static`
- Targeted Playwright desktop and 390 px projects.
- Representative axe checks with no serious/critical violations.
- Production bundle report proving charts and builder code are route-scoped.
- Windows and Linux CI evidence.

## Completion rule

The pass is Ready only when every acceptance criterion in the spec maps to automated evidence or an explicitly recorded visual check that cannot reasonably be automated.
