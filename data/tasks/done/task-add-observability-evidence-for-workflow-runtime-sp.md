---
id: task-add-observability-evidence-for-workflow-runtime-sp
title: Add observability evidence for workflow runtime split
status: done
priority: p3
area: architecture
summary: Builder run 2026-06-28T18-13-10-880Z-builder-erozow resolved source-size advisories but its observability-obligation diagnostic still marked src/core/workflow/runtime-context.ts and src/core/workflow/runtime.ts as missing inspectable evidence.
created_at: 2026-06-28T20:27:05.940Z
updated_at: 2026-06-28T21:56:47.792Z
---

## Problem

Builder run 2026-06-28T18-13-10-880Z-builder-erozow resolved source-size advisories but its observability-obligation diagnostic still marked src/core/workflow/runtime-context.ts and src/core/workflow/runtime.ts as missing inspectable evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T20-14-42-832Z-progress-reviewer-4w1ysg.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T20-14-42-832Z-progress-reviewer-4w1ysg.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 9. The three committed builds closed their target security/platform/source-size tasks, with no open dead letters or operator-journey risks in the packet, but inspected builder diagnostics show untracked observability and source-size warnings.

Evidence ids:

- event:evtj-000000123007
- git:commit:3d1e32cc2e97
- task:task-resolve-workflow-runtime-source-size-advisories

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A recheck artifact maps runtime-context.ts and runtime.ts to structured logging, typed events, explicit error-result evidence, focused test assertions, or waiver rationale; observability-obligation review reports missingFiles empty; focused runtime tests and validate-tasks pass.

## Resolution

- `.kota/runs/2026-06-28T21-51-35-799Z-builder-wrjab9/observability-obligation-recheck.json` replays the original `git:commit:3d1e32cc2e97` production diff with the focused test diff in `src/core/workflow/runtime-context.test.ts`. The detector result is `outcome: "ok"`, `satisfiedFiles` contains both cited files, and `missingFiles` is empty.
- `.kota/runs/2026-06-28T21-51-35-799Z-builder-wrjab9/observability-obligation-review.json` records the current-change diagnostic as `OK: no staged production runtime-observability obligation candidates`.
- Focused validation: `pnpm test src/core/workflow/runtime-context.test.ts src/core/workflow/runtime-lifecycle.test.ts` passed with 2 files and 3 tests.
- Queue validation: `pnpm validate-tasks` passed.
