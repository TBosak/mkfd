# UI Redesign Correction Pass — Design Spec

**Date:** 2026-09-02  
**Status:** Approved  
**Authority:** Mkfd v3 roadmap, Packet 4

## Goal

Correct regressions and inconsistencies introduced by the first redesign without inventing a second visual system. The result must preserve v2 workflows, use one token/component vocabulary, and remain usable with keyboard, screen reader, reduced motion, and a 390 px viewport.

## Scope

- App shell navigation, page titles, skip navigation, focus placement, and complete mobile route access.
- Shared dialog, menu, toast, form-field, loading, empty, and error semantics.
- My Feeds mutation feedback, accessible detail dialog, action reachability, and responsive card/table presentation.
- Token, typography, contrast, icon, motion, and focus-ring reconciliation across shipped pages.
- Removal or integration of dead redesign components, props, CSS, and duplicate source metadata.
- Browser coverage at desktop and 390 px plus automated representative accessibility checks.

## Non-goals

- New source runtime behavior or a wholesale visual rebrand.
- Dark mode unless every shipped surface can meet the same acceptance bar; otherwise remove the dead/incomplete control.
- Fake progress, fake preview data, or client-only Undo for destructive server mutations.

## Acceptance criteria

1. Every shipped route is reachable at desktop and 390 px; current route is programmatically exposed.
2. Keyboard users can enter, operate, dismiss, and recover focus from menus, drawers/dialogs, and destructive confirmations.
3. Every form control has an accessible name, errors are associated and announced, and icon-only controls have names.
4. Text, focus indicators, controls, and semantic states meet WCAG 2.2 AA contrast requirements.
5. Reduced-motion preference removes nonessential transitions; no duplicate animation names cause unrelated motion.
6. Loading, empty, unavailable, partial-failure, and retry states are honest and actionable.
7. No horizontal page overflow or unusable content collapse occurs at 390 px, 768 px, 1024 px, or desktop widths.
8. Route-level code splitting keeps builder-only and chart-only code out of unrelated initial routes; bundle budgets are recorded in the plan.
9. One authoritative source metadata registry supplies labels, icons, colors, route IDs, and capabilities.
10. Playwright keyboard/mobile flows and automated accessibility checks pass in Windows and Linux CI.

## Evidence

Readiness findings for App Shell, My Feeds, Builder, UI Redesign Correction Pass, and Workbench v2 plus aggregate findings C3, C4–C11, D1–D9, E1–E8, F1–F9, G1–G10, and H1.
