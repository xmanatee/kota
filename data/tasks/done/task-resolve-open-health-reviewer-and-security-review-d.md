---
id: task-resolve-open-health-reviewer-and-security-review-d
title: Resolve open health-reviewer and security-review DLQs
status: done
priority: p2
area: autonomy
summary: Two open workflow-dispatch DLQs remain from concurrent autonomy-health-reviewer and security-review activity around task-health-workflow-improver-interrupted-run.md. The health-reviewer item is validation and task-staging fallout, and the security-review item is writeScope attribution against the same task path. Existing ready work covers the improver interrupted-run signal, not these open DLQ items.
created_at: 2026-06-19T01:22:39.774Z
updated_at: 2026-06-19T01:34:09.278Z
---

## Problem

Two open workflow-dispatch DLQs remain from concurrent autonomy-health-reviewer and security-review activity around task-health-workflow-improver-interrupted-run.md. The health-reviewer item is validation and task-staging fallout, and the security-review item is writeScope attribution against the same task path. Existing ready work covers the improver interrupted-run signal, not these open DLQ items.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-19T00-59-48-513Z-progress-reviewer-1t3dli.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

The cited open DLQs were dismissed with recorded rationale after preserving
before/after diagnostics under the builder run directory. The health-reviewer
DLQ was stale validation/staging fallout from the health task before it became
a tracked valid task with `## Initiative`. The security-review DLQ was a
write-scope false attribution: `investigate-candidates` observed the health
task file appearing during its pre/post snapshot window. The runtime scheduler
now treats explicit `concurrencyGroup: "agent"` on code-only workflows as an
exclusive agent slot, so the task-mutating autonomy-health-reviewer cannot
overlap active agent workflows even when `agentConcurrency` is greater than 1.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-19T00-59-48-513Z-progress-reviewer-1t3dli.

review verdict: needs-steering
review summary: The window delivered three committed builds with a 5 Product, 0 Safety, 2 Platform, 1 Meta, 12 Unclassified balance and no operatorJourneyRisks, but two open workflow-dispatch DLQs and one pending owner question keep the scope from being cleanly on track.

Evidence ids:

- dead-letter:dlq-3dee14c8-48ca-4e91-bcd9-f8e93ec5ff17
- dead-letter:dlq-36859e8d-b4d9-474d-a4e6-66593913c382
- run:2026-06-19T00-59-54-583Z-autonomy-health-reviewer-rigs08
- run:2026-06-19T00-24-17-624Z-security-review-zyh0fn
- task:task-health-workflow-improver-interrupted-run
- git:commit:166e9d0a7e8f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/dlq-3dee14c8-before-dismissal.json` and `.kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/dlq-3dee14c8-after-dismissal.json` preserve the health-reviewer DLQ diagnostics and dismissal.
- `.kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/dlq-36859e8d-before-dismissal.json` and `.kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/dlq-36859e8d-after-dismissal.json` preserve the security-review DLQ diagnostics and dismissal.
- `.kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/dead-letter-resolution.md` records the root cause, repair, DLQ state, and validation evidence.
- `pnpm dev workflow dlq list --status open --json` reports `open=0`.
- `pnpm test src/core/workflow/runtime-dispatch.test.ts` covers the `security-review` `investigate-candidates` overlap path against a code-only `autonomy-health-reviewer` task mutation with `agentConcurrency: 2`.
- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.test.ts` covers the workflow's explicit exclusive agent-group declaration.
