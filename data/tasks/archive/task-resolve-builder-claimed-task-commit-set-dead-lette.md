---
status: done
---

# Resolve builder claimed-task-commit-set dead letter

## Problem

The current builder workflow-dispatch dead letter reports the build step
exhausted repair attempts on claimed-task-commit-set while working the
classification follow-up. Inspect the failed builder run referenced by the
dead-letter item, clear or complete the task claim safely, and redrive or
dismiss the DLQ with recorded evidence.

## Desired Outcome

Resolve the progress-review finding from run
2026-07-01T11-01-42-364Z-progress-reviewer-f93wvq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run
2026-07-01T11-01-42-364Z-progress-reviewer-f93wvq.

review verdict: needs-steering
review summary: Needs steering: the window shows security and repair progress
with no operator-journey risks, but balance is Product 0, Safety 0, Platform 0,
Meta 1, Unclassified 13, and builder dispatch has an open
claimed-task-commit-set dead letter.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-ca4b146f-91fc-41c9-a210-881c92bee29b
- scope:8nrg1m:task:task-classify-workflow-generated-follow-up-tasks

## Initiative

Outcome-aware autonomy progress review.

## Current Status

The cited failed builder run was inspected. The stale failed run had claimed
`task-classify-workflow-generated-follow-up-tasks` and failed the
`claimed-task-commit-set` repair check after editing existing `done/` task
records alongside the claimed task state.

The earlier repair run fixed the builder attribution bug that made those
existing terminal-task edits hide the task that became terminal in the commit
set: builder summaries and claimed-task checks now prefer tasks that became
terminal against the comparison ref, while still rejecting commit sets that
newly finish an additional task. The separate classification task was left in
`ready/` by that claimed repair run and was later completed by a separate
builder run.

Canonical cleanup is now complete. The prior blocked cleanup attempts are
preserved in the cited run artifact, and the current canonical cleanup evidence
is recorded below.

## Blocked on
kind: operator-capture
path: .kota/runs/canonical-builder-claimed-task-dlq-cleanup/cleanup-evidence.txt
description: Operator-captured canonical cleanup transcript showing the before state, dismissal or redrive of dlq-ca4b146f-91fc-41c9-a210-881c92bee29b, stale claim release or expiry for task-classify-workflow-generated-follow-up-tasks, and the after state with no open builder claimed-task-commit-set DLQ item or active stale claim.

## Canonical Cleanup Evidence

- `dlq-ca4b146f-91fc-41c9-a210-881c92bee29b` was dismissed in the canonical
  `.kota/dead-letter-queue/items.json` store at `2026-07-03T00:49:35.548Z`.
- The referenced task `task-classify-workflow-generated-follow-up-tasks` is now
  in `data/tasks/archive/`.
- `.kota/task-claims/active/` has no live claim files.
- The leaked qONF80 validation process tree was killed, its untracked
  `node_modules` worktree dirt was removed, and the qONF80 automation worktree
  was cleaned through `cleanupAutomationWorktree`.
- The remaining stale worktrees contain tracked changes, not live locks; their
  stale `builder agent running` worktree locks were cleared after inspection.

## Acceptance Evidence

- `.kota/runs/2026-07-01T12-38-34-978Z-builder-6jn9pm/dead-letter-resolution.md`
  records the cited DLQ, failed run, stale claim, root cause, and sandbox-
  blocked canonical cleanup attempts.
- `task-classify-workflow-generated-follow-up-tasks` was completed by a later
  builder run and now lives in `data/tasks/archive/`, separate from this claimed
  repair run.
- The builder claimed-task repair now accepts the claimed task that became
  terminal even when the commit also edits existing terminal task records, and
  still rejects a commit set that newly completes another task.
