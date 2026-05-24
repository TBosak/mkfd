# Agent Workflow Rules

These rules apply to the entire repository.

## Feature Development Gate (Required)

Before any implementation work begins for a feature:

1. Review corresponding documentation in `docs/features/` for that feature.
2. Review roadmap context in:
   - `docs/features/Mkfd Enhancements Overview.md`
   - `docs/features/Mkfd Release - Review and Plan.md`
3. Create or update a feature spec in `docs/superpowers/specs/`.
4. Create or update an implementation plan in `docs/superpowers/plans/`.
5. Update `docs/superpowers/PROGRESS.md` to reflect spec/plan status.

Implementation code changes are blocked until steps 1-5 are complete.

## Scope Clarification

- The feature spec defines requirements, constraints, security boundaries, and acceptance criteria.
- The implementation plan defines file map, task order, dependencies, and verification strategy.
- If docs conflict, reconcile the conflict in the spec before implementation.

## Notes

- `docs/features/` and `docs/superpowers/` may be ignored by git in this repo; they are still required planning artifacts for local workflow.
