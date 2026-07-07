---
id: task-recover-source-to-decision-builder-dead-letter-and
title: Recover source-to-decision builder dead-letter and claim
status: blocked
priority: p1
area: workflow-runtime
task_class: Meta
summary: Resolve open dead-letter dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0 from the failed builder run for task-add-source-to-decision-coverage-report-for-agent-r, recover or release the active claim, then redrive or dismiss the item with recorded rationale.
created_at: 2026-07-07T05:17:24.396Z
updated_at: 2026-07-07T05:25:38Z
---

## Problem

    Resolve open dead-letter dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0 from the failed builder run for task-add-source-to-decision-coverage-report-for-agent-r, recover or release the active claim, then redrive or dismiss the item with recorded rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-07T04-28-31-947Z-progress-reviewer-9b1zvz.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-07T04-28-31-947Z-progress-reviewer-9b1zvz.

review verdict: needs-steering
review summary:

    Window balance: Safety 5, Product 3, Platform 1, Meta 10. The loop advanced a major Meta autonomy change with decision and validation evidence, but two open builder dead-letter items remain and the newer source-to-decision builder failure needs a non-duplicate recovery follow-up.

Evidence ids:

- dead-letter:dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0
- task:task-add-source-to-decision-coverage-report-for-agent-r

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    The active claim for task-add-source-to-decision-coverage-report-for-agent-r is released, recovered, or superseded with evidence; dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0 is dismissed or redriven with rationale; and a subsequent dead-letter count or progress-review packet no longer reports that item open.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-07-07T04-28-55-926Z-builder-10i0th/operator-dlq-after-redrive-or-dismissal.json
description: after the builder repair-check fix from this branch is available in the canonical checkout, operator releases or supersedes the stale active claim for task-add-source-to-decision-coverage-report-for-agent-r, redrives dlq-19bcae8b-7144-4738-a513-8d13d3ece5a0 or dismisses it if the source-to-decision work has already been recovered, then captures after-state JSON showing no stale active claim and DLQ status redriven or dismissed
```

## Status (2026-07-07 builder)

Root cause fixed in this branch: the builder `autonomy-change-decision` repair
check was reading the canonical workflow run directory, while worktree-mode
builders write `autonomy-change-decision.json` under the agent run directory.
`src/modules/autonomy/workflows/builder/repair-checks.ts` now uses
`builderAgentRunDir(ctx)`, and the regression test in
`src/modules/autonomy/workflows/builder/workflow-repair-checks.test.ts`
covers the worktree-mode path.

Evidence in `.kota/runs/2026-07-07T04-28-55-926Z-builder-10i0th/`:

- `canonical-dead-letter-open-item.json` preserves the open canonical DLQ.
- `autonomy-check-reproduction.txt` shows the repaired lookup passes against
  the failed source-to-decision worktree and the old lookup reproduces the
  missing-artifact failure.
- `claim-release-attempt.json` shows canonical stale-claim release failed with
  `EPERM`.
- `dlq-redrive-simulation-attempt.json` shows canonical DLQ redrive simulation
  failed with `EPERM` while writing `items.json.tmp`.
- `dead-letter-resolution.md` records the rationale and remaining blocker.

This task is blocked on canonical runtime-state mutation evidence rather than
marked done from the worktree-local fix alone.
