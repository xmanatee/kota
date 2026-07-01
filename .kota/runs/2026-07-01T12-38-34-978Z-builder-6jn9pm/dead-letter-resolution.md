# Builder claimed-task DLQ resolution

## Cited item

- Dead letter: `dlq-ca4b146f-91fc-41c9-a210-881c92bee29b`
- Workflow: `builder`
- Failed run: `2026-07-01T09-43-55-464Z-builder-s6r1jg`
- Failure: repair loop made no progress while `claimed-task-commit-set` kept failing.
- Claimed task: `task-classify-workflow-generated-follow-up-tasks`

The canonical dead-letter item was still `open` when inspected from
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`.
The stale claim file was also still active under
`.kota/task-claims/active/task-classify-workflow-generated-follow-up-tasks.json`.

## Root cause

The failed worktree had completed the claimed classification task and had moved
it to `done/`, but it also backfilled `task_class` on existing done tasks cited
by the progress-review evidence. The builder repair check chose a terminal task
from the changed-file set without distinguishing tasks that became terminal in
this run from existing done-task evidence backfills. That made the commit set
look like it resolved a different task and kept `claimed-task-commit-set`
failing.

## Repair landed here

- Updated builder run-summary and claimed-task checks to prefer tasks that
  became terminal in the current commit set, while still rejecting a commit set
  that completes an additional task.
- Added focused tests for claimed-task attribution when existing terminal task
  records are edited as evidence backfills.
- Returned `task-classify-workflow-generated-follow-up-tasks` to `ready/` so
  this run does not complete another task while it owns
  `task-resolve-builder-claimed-task-commit-set-dead-lette`.

## Canonical cleanup status

Direct canonical mutation is blocked from this builder sandbox:

- Releasing the stale claim with `releaseTaskClaim` failed with `EPERM` on the
  canonical `.kota/task-claims/active/...` file.
- Daemon-control HTTP access failed with `TypeError: fetch failed`.
- The worktree-local DLQ CLI could not see the canonical item.

Because the implementation/root cause is repaired but the canonical store still
needs a privileged mutation, `task-resolve-builder-claimed-task-commit-set-dead-lette`
is left in `blocked/` with an `operator-capture` precondition for a canonical
before/action/after cleanup transcript.
