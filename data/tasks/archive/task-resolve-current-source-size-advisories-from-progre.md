---
status: done
---

# Resolve current source-size advisories from progress-review batch

## Problem

Builder runs 2026-06-28T15-23-42-157Z-builder-d8xjbe and 2026-06-28T15-56-27-564Z-builder-j6amm8 left untracked source-size advisories for src/core/daemon/approval-queue.test.ts and src/modules/autonomy/worktree-backed-autonomy-decision.ts. Split cohesive helpers or record a narrow justified exception with evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T16-21-53-726Z-progress-reviewer-b5c7tv.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T16-21-53-726Z-progress-reviewer-b5c7tv.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 3, Meta 0, Unclassified 4. The three batched builder commits closed their intended gaps and the scope has no open dead letters, but two source-size advisories from the reviewed builder runs remain untracked.

Evidence ids:

- task:task-add-observability-evidence-for-approve-all-queue-f
- event:evtj-000000120789
- task:task-migrate-mutating-autonomy-workflows-to-worktree-po
- event:evtj-000000121399

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before evidence: `.kota/runs/2026-06-28T15-23-42-157Z-builder-d8xjbe/source-file-size-review.json` reported `src/core/daemon/approval-queue.test.ts` at 634 lines, and `.kota/runs/2026-06-28T15-56-27-564Z-builder-j6amm8/source-file-size-review.json` reported `src/modules/autonomy/worktree-backed-autonomy-decision.ts` at 311 lines.
- After line counts are recorded in `.kota/runs/2026-06-28T17-14-55-483Z-builder-b03oaq/source-size-line-counts.txt`: approval queue tests are split into 289 / 135 / 252 / 28-line files, and the worktree decision split is 247 / 65 lines.
- Real staged-index source-size diagnostics reported `OK: changed source files are under source-size warning thresholds`.
- Focused approval-queue/autonomy tests passed: 5 files, 55 tests. `pnpm run typecheck`, scoped Biome, and real staged-index task validation passed; details are in `.kota/runs/2026-06-28T17-14-55-483Z-builder-b03oaq/validation.txt`.
