---
status: done
---

# Preserve distinct autonomy health groups during task deduplication

## Problem

    Repair autonomy-health action routing so groups with different dedupe keys are not collapsed merely because they cite overlapping evidence. The current review incorrectly treated missing trajectory diagnostics as covered by the missing agent-step-events task.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-25T00-00-00-006Z-progress-reviewer-y58tqb.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-25T00-00-00-006Z-progress-reviewer-y58tqb.

review verdict: needs-steering
review summary:

    Safety work is shipping and the remaining configuration-path risk is queued, but autonomy-health routing incorrectly merged a distinct trajectory-diagnostics warning into an unrelated ready task. The 24-hour balance is 7 Safety, 1 Platform, 3 Meta, 2 Unclassified, and 0 Product.

Evidence ids:

- scope:8nrg1m:artifact:2026-07-24T22-55-48-899Z-autonomy-health-reviewer-qn6a54:autonomy-health-review.json
- scope:8nrg1m:task:task-health-control-coverage-agent-step-stream-missing-agent-step-events

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused autonomy-health reviewer test supplies two warning groups with shared evidence refs but distinct dedupe keys and proves each remains explicitly tracked, while a replay artifact proves rerunning the same groups creates no duplicate task churn.

## Resolution

The cited reviewer artifact directly reproduced the routing defect: the
agent-step-stream and trajectory-diagnostics groups had distinct dedupe keys
but shared both control-monitor evidence refs. The first group created a task,
then `findOpenTaskRecordingEvidence` treated those refs alone as proof that the
first task also covered the second group.

Open-task evidence matching now requires the exact
`autonomy-health-dedupe-key` marker as well as the evidence refs. This keeps
evidence-based consolidation scoped to one health identity. An explicitly
identified same-key task still suppresses duplicate work, and canonical task
replay remains idempotent.

## Completion Evidence

- `src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-dedupe.test.ts`
  supplies two warning groups with the same two evidence refs and different
  dedupe keys. The first pass creates both tasks; replay creates none and
  returns two same-key skipped actions.
- The autonomy-health reviewer directory plus task-file validation passed:
  7 files, 36 tests. Focused Biome checks and the repository TypeScript
  typecheck also passed.
- `.kota/runs/2026-07-25T11-13-01-618Z-builder-5d6snx/autonomy-health-dedupe-replay.json`
  records the two-group first pass and no-churn replay.
- `.kota/runs/2026-07-25T11-13-01-618Z-builder-5d6snx/autonomy-change-decision.json`
  compares the cited baseline artifact with the candidate and records the
  promotion decision.
