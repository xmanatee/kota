---
status: done
---

# Fix dialogue-driven eval fixture cadence failure

## Problem

Repair `builder-dialogue-driven-coding` so eval-harness cadence produces the required `dialogue-result.json` objective-metric source instead of failing after the fixture task is marked done.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T04-32-45-271Z-progress-reviewer-uu8mn8.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T04-32-45-271Z-progress-reviewer-uu8mn8.

review verdict: needs-steering
review summary: Global window is mostly progressing (task-class balance: Safety 1, Platform 8, Meta 1, Unclassified 10; no Product work; no operator-journey risks or open DLQ), but the newly completed dialogue-driven coding fixture broke the next eval-harness cadence, so one eval-harness follow-up is needed.

Evidence ids:

- scope:8nrg1m:task:task-add-a-dialogue-driven-coding-agent-fixture-to
- scope:8nrg1m:run:2026-06-21T06-00-00-015Z-eval-harness-cadence-ldjqlw

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `pnpm kota eval run --fixture builder-dialogue-driven-coding --repeats 1` or the next eval-harness cadence completes, and the fixture-run artifact records `dialogue_quality_score` sourced from `dialogue-result.json`.
- 2026-06-21 improver run `2026-06-21T05-27-13-407Z-improver-7fhx9i` fixed the source-mode subprocess leak and verified `runEvalHarness` for `builder-dialogue-driven-coding` with `pass@k=1`, `pass^k=1`, and `dialogue_quality_score` mean `1` from one sample.
- Focused validation passed: `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/eval-harness/subprocess-executor.test.ts`, `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/eval-harness/replay-smoke.test.ts`, `pnpm exec biome check src/modules/eval-harness/subprocess-executor.ts src/modules/eval-harness/subprocess-executor.test.ts src/modules/eval-harness/replay-smoke.test.ts`, and `pnpm run typecheck`.
