---
id: task-handle-token-budget-module-adapter-source-size-war
title: Handle token-budget module adapter source-size warnings
status: ready
priority: p3
area: modules
summary: The token-budget builder passed after reducing the severe source-size batch, but it still left advisory warnings for src/modules/gemini-agent-harness/adapter.ts and src/modules/openai-tools-agent-harness/adapter.ts. Split cohesive token-budget/provider helpers or record narrow scoped exceptions without changing harness behavior.
created_at: 2026-06-23T17:48:06.502Z
updated_at: 2026-06-23T17:48:06.502Z
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

## Acceptance Evidence

- Diff reduces or justifies the token-budget-related source-size warnings for the Gemini and OpenAI tools adapter files; focused adapter token-budget tests pass; typecheck, lint, and validate-tasks pass; any remaining oversized adapter surface has a scoped ownership exception.
