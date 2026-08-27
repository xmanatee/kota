---
status: done
---

# Split oversized eval-harness recorder files

## Problem

The source-grounded synthesis fixture build passed, but its builder source-size review reported fresh advisories for src/modules/eval-harness/recorder.test.ts at 600 lines and src/modules/eval-harness/recorder.ts at 386 lines. Split cohesive recorder helpers or focused test fixtures, or record a narrow typed exception, without changing eval-harness recording behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T23-00-00-013Z-progress-reviewer-nsrtbs.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T23-00-00-013Z-progress-reviewer-nsrtbs.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Safety 3, Platform 1, Meta 8, Unclassified 8; the main Platform fixture task completed with critic and replay evidence, but the latest builder left new eval-harness recorder source-size advisories not covered by the two existing ready cleanup tasks.

Evidence ids:

- scope:8nrg1m:run:2026-06-24T03-44-31-181Z-builder-8zj16u
- scope:8nrg1m:task:task-add-a-source-grounded-research-synthesis-fixture-t
- scope:8nrg1m:git:commit:0011826c9e9f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before line counts: `src/modules/eval-harness/recorder.ts` was 386 lines and `src/modules/eval-harness/recorder.test.ts` was 600 lines.
- After line counts: `recorder.ts` is 298 lines; the removed `recorder.test.ts` is split into `recorder-agent-step.test.ts` at 243 lines, `recorder-agent-step-errors.test.ts` at 148 lines, `recorder-judge.test.ts` at 147 lines, `recorder.test-helpers.ts` at 89 lines, and `recorder-run-dir-writes.ts` at 93 lines.
- Focused recorder validation passed: `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/eval-harness/recorder-agent-step.test.ts src/modules/eval-harness/recorder-agent-step-errors.test.ts src/modules/eval-harness/recorder-judge.test.ts`.
- Touched-file formatter/lint passed: `pnpm exec biome check src/modules/eval-harness/recorder.ts src/modules/eval-harness/recorder-run-dir-writes.ts src/modules/eval-harness/recorder.test-helpers.ts src/modules/eval-harness/recorder-agent-step.test.ts src/modules/eval-harness/recorder-agent-step-errors.test.ts src/modules/eval-harness/recorder-judge.test.ts`.
- Typecheck passed: `pnpm typecheck`.
- Task validation passed after staging the final tree: `pnpm validate-tasks`.
