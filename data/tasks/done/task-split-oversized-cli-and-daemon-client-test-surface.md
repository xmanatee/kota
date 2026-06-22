---
id: task-split-oversized-cli-and-daemon-client-test-surface
title: Split oversized CLI and daemon-client test surfaces
status: done
priority: p3
area: architecture
summary: The eval-harness subprocess executor cleanup passed, but its builder run still reported source-file-size warnings for src/core/server/daemon-client.test.ts, src/modules/cli/navigator.test.ts, and src/modules/eval-harness/cli.test.ts. Split cohesive test support or narrower test files without changing daemon-client, CLI navigator, or eval-harness behavior.
created_at: 2026-06-21T09:44:50.364Z
updated_at: 2026-06-22T09:31:44.000Z
---

## Problem

The eval-harness subprocess executor cleanup passed, but its builder run still reported source-file-size warnings for src/core/server/daemon-client.test.ts, src/modules/cli/navigator.test.ts, and src/modules/eval-harness/cli.test.ts. Split cohesive test support or narrower test files without changing daemon-client, CLI navigator, or eval-harness behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T09-29-33-710Z-progress-reviewer-wbbfrq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T09-29-33-710Z-progress-reviewer-wbbfrq.

review verdict: needs-steering
review summary: KOTA is mostly on track but needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 8, Meta 0, Unclassified 9. The batch closed the intended Safety, Platform, and eval-harness cleanup work, with clean dead-letter, fan-out, operator-journey, and evaluator-calibration signals, but the final cleanup run still left three touched oversized test files with source-size warnings and no active duplicate task.

Evidence ids:

- run:2026-06-21T08-53-09-482Z-builder-e8cjyw
- task:task-split-oversized-eval-harness-subprocess-executor-f
- git:commit:74b66fd7d460

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before line counts: `src/core/server/daemon-client.test.ts` 577 lines; `src/modules/cli/navigator.test.ts` 652 lines; `src/modules/eval-harness/cli.test.ts` 872 lines.
- After line counts: `src/core/server/daemon-client.test.ts` 70 lines; `src/modules/cli/navigator.test.ts` 264 lines; `src/modules/eval-harness/cli.test.ts` removed and split into focused files of 117, 170, 157, 122, and 105 lines plus a 146-line CLI test support file.
- All touched replacement source files are under the 300-line source-size warning threshold.
- `pnpm test src/core/server/daemon-client.test.ts src/modules/cli/navigator.test.ts src/modules/eval-harness/cli-list.test.ts src/modules/eval-harness/cli-run-options.test.ts src/modules/eval-harness/cli-run-reporting.test.ts src/modules/eval-harness/cli-calibration.test.ts src/modules/eval-harness/cli-fixture-candidates.test.ts` passed: 7 files, 29 tests.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- `pnpm run validate-tasks` passed after staging the task state move.
- `node --conditions=source --import tsx -e "import { checkSourceFileSize } from './src/modules/autonomy/source-size-check.ts'; console.log(checkSourceFileSize(process.cwd()));"` passed with `OK: changed source files are under source-size warning thresholds`.
