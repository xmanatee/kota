---
id: task-resolve-current-source-size-advisories-from-progre
title: Resolve current source-size advisories from progress-review batch
status: ready
priority: p3
area: architecture
summary: Builder runs 2026-06-28T15-23-42-157Z-builder-d8xjbe and 2026-06-28T15-56-27-564Z-builder-j6amm8 left untracked source-size advisories for src/core/daemon/approval-queue.test.ts and src/modules/autonomy/worktree-backed-autonomy-decision.ts. Split cohesive helpers or record a narrow justified exception with evidence.
created_at: 2026-06-28T16:30:11.512Z
updated_at: 2026-06-28T16:30:11.512Z
---

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

- Record before/after line counts and source-file-size diagnostics for both cited files; each advisory is gone or has a narrow documented exception/rationale; focused approval-queue/autonomy tests and task validation pass.
