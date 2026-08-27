---
status: done
---

# security-review repair-loop rails

## Problem

The autonomy assessment found a confirmed security-review gap: the workflow can reach its commit path after only task-queue validation. Terminal commit safeguards still exist, but the security-review repairable pre-commit step does not include task validation, scratch-artifact checks, `checkCommitStageable`, and commit-message validation as one explicit gate.

## Desired Outcome

Security-review has an explicit `validate-before-commit` step that must pass before any workflow commit. That step runs task validation, scratch-artifact validation, `checkCommitStageable`, and commit-message validation, and it records clear diagnostics when any rail blocks the commit.

## Constraints

- Preserve path-limited commit behavior; do not broaden what security-review can stage or commit.
- Reuse existing commit-safety helpers and repair-loop conventions where possible.
- Do not weaken terminal commit safeguards while adding the repairable preflight.
- Keep the change scoped to security-review unless a shared helper extraction is clearly necessary.

## Done When

- The security-review commit path has an obvious ordering: repair output, `validate-before-commit`, then commit.
- A failed task validation, scratch-artifact check, `checkCommitStageable`, or commit-message check stops the workflow before commit and records the reason.
- Static inspection can prove no workflow commits without repair-loop preflight, excluding builder workflows that already use shared `builderRepairChecks`.
- Path-limited commit behavior is still covered by the workflow logic and artifact evidence.

## Source / Intent

Owner follow-up on 2026-06-19: the main remaining concern from the autonomy assessment is that security-review is missing something and may be letting unsafe work through. Other concerns were accepted as either already solved or expected daemon churn; this one needs direct repair.

## Initiative

Autonomy safety-review reliability.

## Acceptance Evidence

- Include the static query or small script output proving every security-review workflow commit site is gated by `validate-before-commit`.
- Include a captured failure artifact showing one rail blocks commit before staging or committing.
- Include the before/after artifact shape for the new preflight diagnostics.
