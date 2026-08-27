---
status: done
---

# Recover builder continuations that exhaust active runtime

## Problem

    Close the preserved-work recovery regression demonstrated by the recovery-triggered builder that consumed its full active-runtime budget and left an open dead letter. Timeout finalization must preserve reviewable work, avoid duplicate continuations, and provide a bounded path to disposition the claim, worktree, and related dead letter without stranding the underlying Safety task.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-29T18-09-24-191Z-progress-reviewer-njbwoq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-29T18-09-24-191Z-progress-reviewer-njbwoq.

review verdict: needs-steering
review summary:

    The 24-hour window shows concrete delivery, but the scoped outcome is not yet healthy. Task balance is Safety 2, Meta 1, Product 0, Platform 0. Two tasks completed, while a confirmed approval-boundary flaw remains ready and the recently shipped preserved-work recovery path timed out, leaving an open builder dead letter.

Evidence ids:

- scope:8nrg1m:task:task-resume-preserved-builder-work-through-agent-recove
- scope:8nrg1m:git:commit:25ce5a256c60
- scope:8nrg1m:git:commit:0545c63ea4af
- scope:8nrg1m:dead-letter:dlq-2d7964ba-7d49-4572-bdda-9d67156b3d03

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused workflow fixture drives a preserved-work recovery continuation through its configured active-runtime timeout and proves that ambiguous work remains intact with a review artifact, at most one continuation or disposition action is scheduled, and the claim, worktree, and related dead letter are cleared after a successful retry. Include a runtime recovery projection for the failed builder lineage showing no unresolved claim or open related dead letter.

- `src/modules/autonomy/workflows/builder/terminal-worktree-finalizer.test.ts`
  reproduces the cited 21,600,000 ms active-runtime timeout and proves the
  preserved worktree remains intact, the review artifact retains its cleanup
  blocker, and exactly one lineage-keyed recovery request is emitted.
- `src/core/workflow/dead-letter-queue.test.ts` drives a real configured
  active-runtime timeout through the workflow runtime. Together with
  `src/core/workflow/dead-letter-supersession.test.ts`, it proves an unrelated
  builder success cannot close the timeout dead letter and a successful linked
  retry can.
- `src/modules/autonomy/workflows/builder/workflow-recovery-continuation.test.ts`
  proves the linked continuation completes its release-claim and
  cleanup-worktree steps.
- `src/core/workflow/runtime-recovery-keyed-queue.test.ts` restarts with the
  continuation already queued, prepends `runtime.recovered`, replays the
  canonical recovery request, and proves the original keyed continuation still
  executes without a parameter mismatch.
- `.kota/runs/2026-07-30T02-25-30-141Z-builder-xfzrfh/evidence/artifacts/recovery-projection.json`
  records the cited live lineage after disposition: no active claim, the
  worktree removed without blockers, the related dead letter dismissed, and
  the underlying Safety task in `done/`.

## Resolution

The finding was confirmed. A recovery-triggered builder timeout was not
eligible for another bounded continuation because terminal finalization only
retried initial failures or classified provider failures. In addition,
dead-letter supersession treated any later successful run of the same workflow
and step as equivalent, which let an unrelated builder run dismiss the cited
dead letter.

Terminal finalization now recognizes the canonical active-runtime timeout and
emits one explicit idempotency-keyed continuation while preserving the
worktree and review artifact. Finalization and restart scans construct the same
canonical recovery payload, and runtime recovery retains explicitly keyed work
when it prepends reset runs, so a replay cannot strand the accepted
continuation. Transient workflow dead letters now require an explicit run or
redrive lineage before a later success can dismiss them.
