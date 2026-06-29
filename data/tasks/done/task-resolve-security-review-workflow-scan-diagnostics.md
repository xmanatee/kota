---
id: task-resolve-security-review-workflow-scan-diagnostics
title: Resolve security-review workflow-scan diagnostics
status: done
priority: p3
area: security
summary: Builder run 2026-06-29T00-54-05-074Z-builder-wxfnfp closed the security-review due-target candidate-cap issue, but its diagnostics left src/modules/autonomy/workflows/security-review/workflow-scan.test-cases.ts with a missing-observability warning and a 303-line source-size advisory. Add or record inspectable observability evidence or rationale, and either split the file below the source-size guideline or record a narrow justified exception without changing due-target selection behavior.
created_at: 2026-06-29T01:09:19.176Z
updated_at: 2026-06-29T01:17:42.000Z
---

## Problem

Builder run 2026-06-29T00-54-05-074Z-builder-wxfnfp closed the security-review due-target candidate-cap issue, but its diagnostics left src/modules/autonomy/workflows/security-review/workflow-scan.test-cases.ts with a missing-observability warning and a 303-line source-size advisory. Add or record inspectable observability evidence or rationale, and either split the file below the source-size guideline or record a narrow justified exception without changing due-target selection behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-29T01-05-28-885Z-progress-reviewer-0v7dfm.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-29T01-05-28-885Z-progress-reviewer-0v7dfm.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 15. The three reviewed builds closed their target security and diagnostics issues with no open dead letters or operator-journey risks, but the latest security-review fix left a concrete observability warning and source-size advisory on workflow-scan.test-cases.ts.

Evidence ids:

- event:evtj-000000126506
- git:commit:2f053f772015
- git:commit:2f053f772015:file:4
- task:task-ensure-security-review-due-targets-survive-candida

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `src/modules/autonomy/observability-obligation-rules.ts` now treats `.test-cases.ts` files as test-only helpers; `src/modules/autonomy/observability-obligation.test.ts` covers the security-review `.test-cases.ts` shape with `fetch` text and an observable assertion.
- Staged observability check `checkObservabilityObligationsForRun` passed with no production runtime-observability candidates; run artifact `.kota/runs/2026-06-29T01-12-31-451Z-builder-8ai2pp/observability-obligation-review.json` records `missingFiles: []`.
- Staged source-size check `checkSourceFileSize` passed; `src/modules/autonomy/workflows/security-review/workflow-scan.test-cases.ts` is now 291 lines.
- `pnpm test src/modules/autonomy/observability-obligation.test.ts src/modules/autonomy/workflows/security-review/workflow.test.ts` passed with 2 test files and 25 tests.
- `pnpm validate-tasks` passed after moving this task to `done/`.
