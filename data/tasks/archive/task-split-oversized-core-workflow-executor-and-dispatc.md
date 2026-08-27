---
status: done
---

# Split oversized core workflow executor and dispatch files

## Problem

The progress-review journal backfill landed successfully but its builder run reported source-size warnings on touched core workflow files: src/core/workflow/run-executor.ts and src/core/workflow/runtime-dispatch.ts. Extract cohesive helpers or record a narrow typed exception while preserving workflow runtime behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T04-52-56-923Z-progress-reviewer-l2zh4v.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T04-52-56-923Z-progress-reviewer-l2zh4v.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 2, Platform 5, Meta 0, Unclassified 11. The journal-backfill work landed with verification and clean monitors, but the latest builder left touched core workflow files over the source-size guideline with no active duplicate follow-up in the exposed queue evidence.

Evidence ids:

- scope:8nrg1m:run:2026-06-22T06-52-58-622Z-builder-bopz18
- scope:8nrg1m:git:commit:5d34ebdbacbf
- scope:8nrg1m:task:task-split-oversized-cli-and-daemon-client-test-surface

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-22T18-58-36-187Z-builder-56a3rx/line-count-evidence.txt` records the split: `run-executor.ts` went from 488 to 276 lines and `runtime-dispatch.ts` went from 337 to 268 lines; new workflow helper files are 234, 108, and 89 lines.
- Source-size diagnostics against the temporary staged index reported `OK: changed source files are under source-size warning thresholds`.
- Focused workflow tests passed: 7 files, 111 tests.
- `pnpm run typecheck` and `pnpm run lint` passed. `pnpm run validate-tasks` passed against the temporary staged index; the real-index invocation is blocked by this sandbox's `.git` write restriction.
