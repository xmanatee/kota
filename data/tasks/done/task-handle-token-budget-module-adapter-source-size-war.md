---
id: task-handle-token-budget-module-adapter-source-size-war
title: Handle token-budget module adapter source-size warnings
status: done
priority: p3
area: modules
summary: The token-budget builder passed after reducing the severe source-size batch, but it still left advisory warnings for src/modules/gemini-agent-harness/adapter.ts and src/modules/openai-tools-agent-harness/adapter.ts. Split cohesive token-budget/provider helpers or record narrow scoped exceptions without changing harness behavior.
created_at: 2026-06-23T17:48:06.502Z
updated_at: 2026-06-23T20:05:00.000Z
---

## Problem

The token-budget builder passed after reducing the severe source-size batch, but it still left advisory warnings for src/modules/gemini-agent-harness/adapter.ts and src/modules/openai-tools-agent-harness/adapter.ts. Split cohesive token-budget/provider helpers or record narrow scoped exceptions without changing harness behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T17-25-52-167Z-progress-reviewer-47qvir.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T17-25-52-167Z-progress-reviewer-47qvir.

review verdict: needs-steering
review summary: KOTA is mostly on track: Product 0, Safety 2, Platform 2, Meta 1, Unclassified 14. The token-budget build landed with review and calibration evidence, dead-letter/operator-journey signals are clean, but the build left module adapter source-size warnings not covered by the existing core-only cleanup task.

Evidence ids:

- artifact:2026-06-23T14-27-59-282Z-builder-l5pers:source-file-size-review.json
- git:commit:71524dd197d7
- task:task-handle-recent-core-tool-source-size-warnings

## Initiative

Outcome-aware autonomy progress review.

## Result

The Gemini and OpenAI tools adapters now keep provider option handling, token-budget result shaping, and tool-dispatch/content helpers in local helper modules. The touched adapter files dropped below the 300-line source-size advisory threshold: `src/modules/gemini-agent-harness/adapter.ts` is 287 lines and `src/modules/openai-tools-agent-harness/adapter.ts` is 253 lines; every new helper file is below 300 lines.

## Acceptance Evidence

- Focused adapter and token-budget tests passed: `pnpm test src/modules/gemini-agent-harness/adapter.test.ts src/modules/gemini-agent-harness/adapter-token-budget.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts src/modules/openai-tools-agent-harness/adapter-token-budget.test.ts` (4 files, 48 tests).
- `pnpm typecheck`, `pnpm lint`, `pnpm validate-tasks`, and `pnpm test src/strict-types-policy.integration.test.ts` passed.
- Source-size severe and advisory checks both returned `OK: changed source files are under source-size warning thresholds`; see `.kota/runs/2026-06-23T19-47-15-526Z-builder-et00ya/source-file-size-review.json`.
