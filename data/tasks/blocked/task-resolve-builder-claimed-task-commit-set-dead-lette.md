---
id: task-resolve-builder-claimed-task-commit-set-dead-lette
title: Resolve builder claimed-task-commit-set dead letter
status: blocked
priority: p1
area: autonomy
task_class: Platform
summary: The current builder workflow-dispatch dead letter reports the build step exhausted repair attempts on claimed-task-commit-set while working the classification follow-up. Inspect the failed builder run referenced by the dead-letter item, clear or complete the task claim safely, and redrive or dismiss the DLQ with recorded evidence.
created_at: 2026-07-01T12:34:02.462Z
updated_at: 2026-07-01T13:08:27.000Z
---

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

This run repairs the builder attribution bug that made those existing
terminal-task edits hide the task that became terminal in the commit set:
builder summaries and claimed-task checks now prefer tasks that became terminal
against the comparison ref, while still rejecting commit sets that newly finish
an additional task. The separate classification task is left in `ready/` so
this claimed run does not complete another task.

Canonical cleanup is still blocked from this worktree sandbox:

- Direct claim release against `/Users/xmanatee/Desktop/mono/apps/kota` failed
  with `EPERM` on the canonical `.kota/task-claims/active/...` file.
- Daemon-control HTTP access failed with `TypeError: fetch failed`.
- The worktree-local DLQ CLI could not see the canonical dead-letter item.

## Unblock Precondition

kind: operator-capture
path: .kota/runs/canonical-builder-claimed-task-dlq-cleanup/cleanup-evidence.txt
description: Operator-captured canonical cleanup transcript showing the before state, dismissal or redrive of dlq-ca4b146f-91fc-41c9-a210-881c92bee29b, stale claim release or expiry for task-classify-workflow-generated-follow-up-tasks, and the after state with no open builder claimed-task-commit-set DLQ item or active stale claim.

## Acceptance Evidence

- `.kota/runs/2026-07-01T12-38-34-978Z-builder-6jn9pm/dead-letter-resolution.md`
  records the cited DLQ, failed run, stale claim, root cause, and sandbox-
  blocked canonical cleanup attempts.
- `task-classify-workflow-generated-follow-up-tasks` remains in `ready/` for a
  future builder run instead of being completed in this claimed repair.
- The builder claimed-task repair now accepts the claimed task that became
  terminal even when the commit also edits existing terminal task records, and
  still rejects a commit set that newly completes another task.
