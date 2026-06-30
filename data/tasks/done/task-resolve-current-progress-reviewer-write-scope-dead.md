---
id: task-resolve-current-progress-reviewer-write-scope-dead
title: Resolve current progress-reviewer write-scope dead letter
status: done
priority: p2
area: platform
summary: Investigate open DLQ dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7 where progress-reviewer review-evidence failed with tracked builder workflow files outside its declared .kota/runs write scope. Determine whether this is a real agent mutation or cross-run dirty-worktree attribution, then fix, redrive, or dismiss with durable rationale.
created_at: 2026-06-29T18:19:19.523Z
updated_at: 2026-06-30T20:25:00Z
---

## Problem

Investigate open DLQ dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7 where progress-reviewer review-evidence failed with tracked builder workflow files outside its declared .kota/runs write scope. Determine whether this is a real agent mutation or cross-run dirty-worktree attribution, then fix, redrive, or dismiss with durable rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-29T18-16-25-215Z-progress-reviewer-k3so0x.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

The failure was a cross-run write-scope false attribution path, not a real
progress-reviewer source mutation. `review-evidence` is a passive agent with
read-only tools and `.kota/runs/` write scope, while the cited paths are
builder workflow source files.

Agent-step execution now serializes named agent harness runs per workspace and
captures the write-scope pre-snapshot only after acquiring that workspace lane.
The post-snapshot, trajectory artifact, and violation artifact are recorded
before releasing the lane. Repair-agent iterations use the same lane, so repair
loops cannot overlap a passive reviewer in the same checkout either.

The canonical DLQ item was read from
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`.
This sandbox could not dismiss it because writes to canonical project state and
the worktree git index are outside the writable roots; the run artifact records
that limitation. The source root cause is fixed with same-shape regression
coverage.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-29T18-16-25-215Z-progress-reviewer-k3so0x.

review verdict: needs-steering
review summary: Product 0, Safety 0, Meta 0, Platform 2, Unclassified 12. Security review is producing actionable work, but one current open progress-reviewer write-scope dead letter needs a normal follow-up.

Evidence ids:

- dead-letter:dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-30T19-53-51-915Z-builder-ggdpuf/dead-letter-resolution.md` records the before DLQ state, root cause, code repair, validation commands, and the canonical-store dismissal limitation.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/core/workflow/runtime-dispatch.test.ts` passed with 9 tests, including the builder/progress-reviewer shared-workspace false-attribution regression.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/builder/runtime-resources.test.ts src/modules/daemon-ops/operator-ui-worktree-status.test.ts src/modules/daemon-ops/status-cli-worktrees.test.ts` passed with 12 tests.
- `pnpm run typecheck` passed after tightening the builder runtime resource profile type.
