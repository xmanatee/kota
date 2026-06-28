---
id: task-add-observability-evidence-for-worktree-decision-s
title: Add observability evidence for worktree decision split
status: done
priority: p2
area: autonomy
summary: Builder run 2026-06-28T17-14-55-483Z-builder-b03oaq resolved the source-size task but its observability-obligation diagnostic reported missing inspectable evidence for src/modules/autonomy/worktree-backed-autonomy-decision-types.ts and src/modules/autonomy/worktree-backed-autonomy-decision.ts.
created_at: 2026-06-28T17:32:13.053Z
updated_at: 2026-06-28T17:35:53Z
---

## Problem

Builder run 2026-06-28T17-14-55-483Z-builder-b03oaq resolved the source-size task but its observability-obligation diagnostic reported missing inspectable evidence for src/modules/autonomy/worktree-backed-autonomy-decision-types.ts and src/modules/autonomy/worktree-backed-autonomy-decision.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T17-29-20-403Z-progress-reviewer-71urr8.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T17-29-20-403Z-progress-reviewer-71urr8.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 3, Meta 0, Unclassified 6. Recent monitored workflows succeeded, dead letters are clear, and the prior source-size task was closed, but the latest builder run left an untracked observability-obligation warning for two runtime-sensitive autonomy files.

Evidence ids:

- run:2026-06-28T17-14-55-483Z-builder-b03oaq
- git:commit:f33b45726f84

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run artifact or task acceptance section maps both cited files to structured logging, typed events, explicit error-result evidence, focused test assertions, or an explicit waiver rationale; the observability-obligation diagnostic reports no unresolved missing files for this change; focused autonomy tests and task validation pass.

## Resolution Evidence

- Added focused autonomy test coverage in `src/modules/autonomy/worktree-backed-autonomy-decision.test.ts` asserting the permission-sensitive worktree rollout remains observable through accepted status, safety-rule metadata, pending-merge operator visibility, and status-before-parallelism rollout order.
- `.kota/runs/2026-06-28T17-29-39-683Z-builder-e7xwpt/observability-obligation-recheck.json` records the detector recheck against `git:commit:f33b45726f84` plus the follow-up test diff. The recheck result is `outcome: "ok"`, `satisfiedFiles` contains both cited files, and `missingFiles` is empty.
- `.kota/runs/2026-06-28T17-29-39-683Z-builder-e7xwpt/worktree-decision-observability-evidence.json` maps both cited files to the focused test assertion and the explicit rationale artifact.
- `.kota/runs/2026-06-28T17-29-39-683Z-builder-e7xwpt/observability-obligation-rationale.json` records why the type-only decision split should be evidenced by focused tests and run-artifact rationale rather than runtime logging or event emission.
- `.kota/runs/2026-06-28T17-29-39-683Z-builder-e7xwpt/observability-obligation-review.json` reports `outcome: "ok"` with no current production candidates for the follow-up diff.
- Validation: `pnpm test src/modules/autonomy/worktree-backed-autonomy-decision.test.ts src/modules/autonomy/observability-obligation.test.ts` passed with 2 files and 12 tests; `pnpm validate-tasks` passed.
