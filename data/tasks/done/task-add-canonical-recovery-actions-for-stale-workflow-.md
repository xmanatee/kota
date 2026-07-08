---
id: task-add-canonical-recovery-actions-for-stale-workflow-
title: Add canonical recovery actions for stale workflow claims
status: done
priority: p1
area: workflow-runtime
task_class: Meta
summary: Give KOTA a daemon-owned recovery path for stale pending-merge task claims and related dead-letter items so empty queues can recover without sandbox-local canonical state mutation.
created_at: 2026-07-08T00:54:52.499Z
updated_at: 2026-07-08T01:41:00.000Z
---

## Problem

KOTA now exposes pending-merge task claims and dead-letter items clearly, but
the recovery path still falls back to operator-captured canonical state
mutation when the sandbox cannot write `.kota/task-claims` or
`.kota/dead-letter-queue`. That is enough for honesty, but it can leave the
dispatchable queue empty while all real recovery work sits behind manual
operator capture.

The current empty-queue run shows the pattern. `inspect-queue` reports one
ready p1 task, `task-run-shadow-semantic-reviewers-for-non-builder-auto`, but
it is claim-blocked by builder run
`2026-07-07T06-33-49-256Z-builder-79nvwh` in `pending-merge`. Related blocked
tasks already preserve the evidence and attempted repairs, but they cannot
advance without operator-captured canonical mutation:

- `task-recover-shadow-review-branch-blocked-by-merge-gate`
- `task-recover-shadow-reviewer-builder-dead-letter-and-cl`
- `task-recover-source-to-decision-builder-dead-letter-and`
- `task-resolve-stale-builder-dead-letter-item`

KOTA needs a first-class recovery action for this runtime-state shape instead
of repeatedly asking builders or explorers to encode one-off operator-capture
tasks after the queue is already stalled.

## Desired Outcome

Add a canonical recovery path for stale workflow-runtime state that can resolve
a pending-merge task claim and the related dead-letter disposition through the
runtime owner rather than through sandbox-local file edits.

The recovery path should:

- inspect pending-merge task claims, their owning workflow run, worktree or
  merge-gate evidence, and any related dead-letter ids;
- decide whether the claim is still active, safely releasable, superseded, or
  still blocked on real merge/conflict evidence;
- release or supersede stale claims only through a daemon-owned or
  workflow-runtime-owned mutation boundary that records who/what initiated it
  and why;
- reuse existing dead-letter dismiss/redrive controls rather than creating a
  second DLQ store or command family;
- write an inspectable recovery artifact under `.kota/runs/<run-id>/` with the
  before state, action taken, reason, and after state; and
- surface the action in operator-visible attention/status output when the
  dispatchable queue is empty only because ready work is claim-blocked.

## Constraints

- Do not bypass the builder merge gate, task-claim lease rules, worktree
  cleanup checks, direct-commit prevention, or DLQ redrive safety.
- Do not auto-release a pending-merge claim while its branch still has
  unresolved merge/conflict evidence or an active owner.
- Do not make explorer, progress-reviewer, or builder agents patch canonical
  `.kota/` files directly to recover runtime state.
- Keep the operation scope-aware and auditable. A recovery action in one scope
  must not mutate another scope's claims or dead-letter items.
- Prefer extending the existing task-claim, workflow-ops, daemon-control, and
  attention/status surfaces over adding a parallel recovery subsystem.

## Done When

- A daemon-owned or workflow-runtime-owned operation can list pending-merge
  task claims with their run/worktree/merge evidence and report the safe next
  action.
- The operation can release or mark superseded a stale pending-merge claim with
  a required rationale and recorded before/after artifact.
- Related DLQ recovery uses the existing dead-letter dismiss/redrive paths and
  can be linked from the same recovery artifact when a stale claim and DLQ item
  belong to the same failed/superseded workflow.
- Queue inspection, attention output, or operator status output points to the
  canonical recovery action when all ready work is claim-blocked by
  pending-merge state.
- Tests cover safe release, refusal when merge evidence is still unresolved,
  scope isolation, related DLQ linking, idempotent repeat recovery, and the
  empty-queue claim-blocked reporting path.

## Source / Intent

Explorer run `2026-07-08T00-18-37-608Z-explorer-r0pzb9` found
`actionableCount: 0`, `promotableBacklogCount: 0`, and one ready task blocked
only by a pending-merge claim. The strategic blocked alternatives surfaced by
`inspect-queue` all require operator-captured live evidence and are not
movable, so the most useful next ready task is to remove the repeated
workflow-runtime recovery gap that caused the queue stall.

Local context checked:

- `src/core/daemon/daemon-control-routes.ts` and
  `src/modules/workflow-ops/execution/dead-letter.ts` already expose scoped
  DLQ list/show/dismiss/redrive controls.
- `src/modules/autonomy/task-claims.ts` exposes claim inspection, pending-merge
  marking, release, resume, and workspace updates, but the current recovery
  evidence still requires direct canonical claim mutation when no runtime-owned
  operator action is available.
- Existing progress-reviewer-generated blocked tasks preserve the repeated
  DLQ/claim evidence but cannot move until operator-captured state mutation is
  recorded.

## Initiative

Autonomy recovery without operator-only canonical state edits.

## Product / Safety Link

Safety: stale claims and DLQ items gate autonomous execution. A first-class,
audited recovery path reduces pressure to hand-edit runtime state while keeping
merge-gate and redrive safety intact.

## Acceptance Evidence

- Focused test transcript covering pending-merge claim recovery, refusal cases,
  scope isolation, DLQ linking, and claim-blocked empty-queue reporting.
- CLI or daemon-control transcript from a temporary project showing a stale
  pending-merge claim inspected, safely released or superseded with rationale,
  and reflected in subsequent queue availability.
- Sample `.kota/runs/<run-id>/workflow-state-recovery.json` artifact containing
  before state, action, rationale, related DLQ ids if any, and after state.
- `pnpm run validate-tasks` passes after the recovery task and any generated
  follow-up state are present.
