# Feature Spec + Plan Intake Checklist

Use this checklist before writing implementation code for any feature.

## 1. Context Review (Required)

- [ ] Read corresponding feature documentation in `docs/features/`.
- [ ] Review cross-feature dependencies in `docs/features/Mkfd Enhancements Overview.md`.
- [ ] Review release/tier ordering in `docs/features/Mkfd Release - Review and Plan.md`.
- [ ] Confirm current status in `docs/superpowers/PROGRESS.md`.

## 2. Specification (Required)

- [ ] Create or update a spec in `docs/superpowers/specs/`.
- [ ] Define problem statement and goals.
- [ ] Define architecture and integration boundaries.
- [ ] Define security and data-handling decisions.
- [ ] Define acceptance criteria and non-goals.

## 3. Implementation Plan (Required)

- [ ] Create or update a plan in `docs/superpowers/plans/`.
- [ ] Include dependency/precondition section.
- [ ] Include file map with create/modify responsibilities.
- [ ] Break work into ordered tasks with verification points.
- [ ] Include testing strategy and rollout notes.

## 4. Progress Tracking (Required)

- [ ] Update `docs/superpowers/PROGRESS.md` for spec/plan status.
- [ ] Ensure phase placement matches dependency order.
- [ ] Note blockers or prerequisites explicitly.

## 5. Ready for Implementation

Proceed with implementation only when all required boxes above are checked.
