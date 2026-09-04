# Workbench v2 Frontend Redesign — Design Spec

**Date:** 2026-09-02  
**Status:** Approved  
**Authority:** Mkfd v3 roadmap, Packet 5

## Goal

Ship one responsive, source-aware feed workbench that preserves useful v2 creation and editing behavior while supporting v3 source types through explicit capabilities rather than generic or fabricated UI.

## Required workflows

- Choose a supported source, create, edit, preview where supported, save, discard, and recover from failures.
- Load and save representative v2 web, REST API, and email configurations without semantic loss.
- Preserve Selector Playground and direct selector suggestion for web scraping.
- Preserve explicit FlareSolverr controls and health navigation for web scraping.
- Configure feed output/delivery, including enabled state, output format, reverse/strict where applicable, webhook enablement/customization, and email access to applicable controls.
- Change source type without silent loss: preserve per-type drafts or require explicit confirmation before destructive reset.

## Source capability contract

Workbench steps, fields, preview, and actions derive from the authoritative source registry. Unsupported behavior is hidden or shown as explicitly unavailable; it is never simulated. The v3 list is the ten sources frozen by ADR 0001. Top-level `changeDetection` is rejected.

## Compatibility acceptance

Golden v2 web/API/email configurations must survive load → edit without change → preview where supported → save → restart with equivalent runtime behavior. This includes CSS targets, iterators, drill chains, GUID semantics, RSS metadata, rich headers/cookies, API mappings, enabled state, webhook settings, and protected/env/plain value variants.

## Responsive and accessibility acceptance

1. At 390 px the active form remains readable and operable; preview becomes a deliberate tab/drawer/stack and cannot squeeze the form below its usable width.
2. At tablet and desktop widths section navigation and preview do not obscure form actions or validation.
3. One submission state prevents double submit from header/footer actions.
4. Step changes and validation failures move focus predictably and are announced.
5. Selector, key/value, cookie, body, mapping, and protected-value editors are fully keyboard operable and expose row errors.
6. Destructive discard/type-switch actions require confirmation when dirty.

## Performance acceptance

- Builder code is lazy-loaded away from non-builder routes.
- Expensive editor/preview modules load only when used.
- Autosave is bounded and does not serialize secrets or cause typing jank.
- Bundle and interaction budgets are recorded and enforced by the implementation plan.

## Non-goals

- Fabricated preview XML or fake staged progress.
- Reimplementing runtime policy in the frontend.
- Removing v2 features to simplify the form.
- Enabling a source whose create-to-output path is incomplete.
