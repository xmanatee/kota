---
status: done
---

# Recover two stale builder worktrees blocking ready security tasks

## Problem

    Use the canonical state-recovery path to inspect and disposition the preserved worktrees for task-security-review-codex-passive-mode-does-not-enforc and task-security-review-workflow-handoff-children-do-not-i, preserving any non-superseded changes and reconciling their expired active claims and task states.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-06T09-36-58-522Z-progress-reviewer-g3jzpr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-06T09-36-58-522Z-progress-reviewer-g3jzpr.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m (kota), run-count review covering 2026-08-05T10:29:13.835Z through 2026-08-06T10:29:13.835Z. Included 20 runs, 20 tasks, 30 events, 40 artifacts, 60 git references, and 170 evidence references; no open dead letters, owner questions, approvals, or operator-journey risks were reported. Task balance was Safety 16, Meta 4, Product 0, and Platform 0. Safety remediation delivered a tested GitHub-content trust-boundary fix, but evaluator calibration remains blind and two ready security tasks remain stalled behind expired claims and preserved dirty worktrees. Exclusions included 57 policy-pruned run references plus truncated run, task, event, artifact, changed-file, git, and lower-detail evidence. Applied actions: propose one non-duplicate P1 autonomy follow-up for the stalled worktrees; rely on the existing ready P2 task for evaluator-verdict coverage; no owner question is currently justified.

Evidence ids:

- run:2026-08-06T08-30-07-457Z-builder-xegyv9

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    State-recovery evidence records a recover, supersede, or preserve disposition for both worktrees; every non-superseded change is merged or durably preserved; the expired active claims are cleared or reconciled; and a subsequent builder queue inspection shows each task as claimable or done rather than skipped-stale-worktree.

## Recovery Blocker

- Builder evidence: `.kota/runs/2026-08-06T11-39-00-766Z-builder-ljn8o9/evidence/artifacts/recovery-analysis.txt`.
- This sandbox cannot read the canonical active-claim store or the two preserved worktrees, and cannot reach the authenticated daemon control address. The read-only branch/index projection is insufficient to authorize a recover, supersede, or discard disposition.
- Continue from the canonical project runtime with the exact active claim run ids recorded in the builder evidence; inspect unstaged and untracked work before applying the recovery provider recommendation.

## Blocked on
```
kind: operator-capture
path: .kota/runs/task-recover-two-stale-builder-worktrees-blocking-ready/canonical-state-recovery.json
description: from the canonical project runtime, capture state-recovery disposition evidence for both preserved worktrees, including claim reconciliation and the subsequent builder queue inspection
```

## Resolution

Both cited security tasks are complete with recorded verification evidence. On 2026-08-11, the canonical recovery projection reported no stale worktrees or unresolved claims; the only worktree was owned by the current active builder and correctly classified as `active`. The obsolete operator-capture blocker is therefore satisfied, and the task no longer belongs in the blocked queue.
