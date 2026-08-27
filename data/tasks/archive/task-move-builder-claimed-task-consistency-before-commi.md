---
status: done
---

# Move builder claimed-task consistency before commit

## Problem

Builder run 2026-06-28T12-36-26-477Z-builder-hd8dph claimed task-add-open-knowledge-format-compatibility-to-knowled but committed task-security-review-the-approve-all-control-path-prefl before the claimed-task consistency check failed. Move the mismatch gate before git commit and recover this mismatch shape so failed builders cannot land unrelated commits or strand claims.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 1, Safety 1, Platform 1, Meta 0, Unclassified 6. Product and security work landed with no operator-journey risk, but the latest builder committed one task while holding another claim, failed only after commit, and the scope still has open dead letters.

Evidence ids:

- run:2026-06-28T12-36-26-477Z-builder-hd8dph
- dead-letter:dlq-77f2249b-48e5-4c00-b1e8-a9b8784ca2a7
- git:commit:a0cd7bee2005
- task:task-add-open-knowledge-format-compatibility-to-knowled
- task:task-security-review-the-approve-all-control-path-prefl
- task:task-block-builder-claimed-task-commit-mismatches

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused builder workflow tests reproduce the current claimed-task/run-summary mismatch and prove no git commit is attempted, workflow.build.committed is not emitted, and the claimed task is released, marked retryable, or recovered with durable rationale; dlq-77f2249b-48e5-4c00-b1e8-a9b8784ca2a7 is cleared or superseded after validation.

## Resolution

Builder now runs `check-claimed-task-consistency` before `commit`, using the
workflow-owned terminal task mutation set instead of the post-commit
`run-summary.json`. A mismatch releases the active task claim with durable
retry evidence, then fails before any commit or `workflow.build.committed`
event can occur. Downstream release, calibration, emit, and restart gates also
require an actual committed change.

## Evidence

- `pnpm test src/modules/autonomy/workflows/builder src/modules/autonomy/builder-commit-gates.test.ts`
  passed, including the mismatch test asserting no `commitWorkflowChanges`
  call, no `workflow.build.committed` event, and a released claim with evidence.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm dev workflow validate`
  passed.
- `.kota/runs/2026-06-28T12-52-03-869Z-builder-dgg2jt/dlq-77f2249b-before-dismissal.json`
  preserves the cited DLQ item before dismissal.
- `.kota/runs/2026-06-28T12-52-03-869Z-builder-dgg2jt/dlq-77f2249b-after-dismissal.json`
  records it dismissed as superseded by this fix.
- `pnpm dev workflow dlq list --status open --workflow builder --json` no
  longer lists `dlq-77f2249b-48e5-4c00-b1e8-a9b8784ca2a7`; the remaining open
  builder DLQ is the unrelated build-timeout item
  `dlq-2cd9edfa-3573-4b28-9cfc-6c4d1ec3afb5`.
