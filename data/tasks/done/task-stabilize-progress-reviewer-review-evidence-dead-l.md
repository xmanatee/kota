---
id: task-stabilize-progress-reviewer-review-evidence-dead-l
title: Stabilize progress-reviewer review-evidence dead letters
status: done
priority: p1
area: autonomy
summary: Multiple open progress-reviewer DLQ items show review-evidence timing out, plus one validation failure from citing an evidence id outside the flat packet. Bound the review path so large or count-triggered packets complete or degrade deterministically and agent output cites only packet evidence ids.
created_at: 2026-06-16T22:59:46.605Z
updated_at: 2026-06-17T00:01:30.000Z
---

## Problem

Multiple open progress-reviewer DLQ items show review-evidence timing out, plus one validation failure from citing an evidence id outside the flat packet. Bound the review path so large or count-triggered packets complete or degrade deterministically and agent output cites only packet evidence ids.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-16T22-23-48-097Z-progress-reviewer-8j3ecl.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-16T22-23-48-097Z-progress-reviewer-8j3ecl.

review verdict: needs-steering
review summary: The reviewed batch delivered the security fix and quiet post-build monitors, but recurring progress-reviewer review-evidence dead letters need a bounded repair.

Evidence ids:

- dead-letter:dlq-bae315f4-fdba-4d37-bcbf-71eb563a2d9f
- dead-letter:dlq-a5ef6ca9-9be5-4ad3-8032-06fed01820e3
- dead-letter:dlq-0a676c1c-b149-4d35-87cf-9b579fb669d8
- dead-letter:dlq-3fdd4b8c-d3b5-493f-bd24-0655cfd7b9c5

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused progress-reviewer fixture or redrive artifact showing a large run-count evidence packet returns schema-valid JSON within the step timeout, cites only ids from the flat evidence array, and records redrive or dismissal evidence for the cited DLQ items.

## Completion Evidence

- `src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` includes a focused large run-count fixture proving `prepare-review-input` keeps the batched run and progress-reviewer DLQ ids citeable, trims lower-detail evidence, and rejects ids that are not in the exposed flat evidence array.
- `src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` also exercises the real `executeWorkflowRun` path for `review-evidence` with a large run-count packet, a registered fake harness, the production 1800000ms step timeout, schema-valid fenced JSON, and a generated `progress-review.json` artifact containing full evidence plus compact `reviewInput`.
- `.kota/runs/2026-06-16T23-00-21-494Z-builder-k9wmol/progress-reviewer-bounded-review-evidence.json` records the cited 2026-06-16 progress-review packet compacting from 110509 bytes / 149 evidence refs to 24092 bytes / 81 exposed evidence refs while preserving all four cited DLQ ids and rejecting a hidden artifact id.
- `.kota/runs/2026-06-16T23-00-21-494Z-builder-k9wmol/progress-reviewer-review-evidence-runtime-fixture.json` records the runtime-step fixture and the passing focused test command.
- `.kota/runs/2026-06-16T23-00-21-494Z-builder-k9wmol/progress-reviewer-dlq-resolution.json` records before/after state for the four cited DLQ items; `.kota/dead-letter-queue/items.json` now marks each cited item `dismissed` with the superseded-by-fix rationale.
- Verification: `pnpm exec vitest run src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts`, `pnpm run typecheck`, `pnpm exec biome check src/modules/autonomy/workflows/progress-reviewer/progress-review.ts src/modules/autonomy/workflows/progress-reviewer/workflow.ts src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts`, and `pnpm run validate-tasks`.
