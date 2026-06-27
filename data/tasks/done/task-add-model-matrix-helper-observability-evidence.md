---
id: task-add-model-matrix-helper-observability-evidence
title: Add model-matrix helper observability evidence
status: done
priority: p2
area: modules
summary: Builder run 2026-06-27T13-04-14-521Z-builder-ys29is closed the model-matrix source-size task but its observability-obligation diagnostic still marked src/modules/harness-parity/model-matrix.test-support.ts as missing inspectable evidence.
created_at: 2026-06-27T13:20:38.309Z
updated_at: 2026-06-27T14:02:55.000Z
---

## Problem

Builder run 2026-06-27T13-04-14-521Z-builder-ys29is closed the model-matrix source-size task but its observability-obligation diagnostic still marked src/modules/harness-parity/model-matrix.test-support.ts as missing inspectable evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T13-16-13-795Z-progress-reviewer-r03kfa.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T13-16-13-795Z-progress-reviewer-r03kfa.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 6, Meta 0, Unclassified 11. Recent source-size work landed, with no operator-journey risks or open dead letters reported, but the latest builder success mismatched its claimed task versus committed task and left a new model-matrix helper observability warning untracked.

Evidence ids:

- run:2026-06-27T13-04-14-521Z-builder-ys29is
- git:commit:981c25c0edb6
- task:task-handle-model-matrix-test-source-size-advisory
- task:task-add-observability-evidence-for-scaffold-model-matr

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run artifact or task result maps src/modules/harness-parity/model-matrix.test-support.ts to focused test assertions, structured evidence, or an explicit waiver rationale; the observability diagnostic reports no unresolved missing file for that helper; focused harness-parity tests and validate-tasks pass.

## Result

Added focused model-matrix assertions that prove the extracted fixing harness
helper's emitted tool-call/tool-result frames are reflected in row-level
`toolCounts`, row-level `trajectoryDiagnostics`, and the serialized
`model-matrix-report.json`.

## Evidence

- `.kota/runs/2026-06-27T13-52-58-331Z-builder-sccfw3/model-matrix-helper-observability-resolution.json` replays the original `git:commit:981c25c0edb6` helper diff with the new focused test diff; the observability diagnostic marks `src/modules/harness-parity/model-matrix.test-support.ts` satisfied by `focused-test-assertion` with `missingFiles: []`.
- `pnpm -s test src/modules/harness-parity/model-matrix.test.ts`
- `pnpm -s validate-tasks`
