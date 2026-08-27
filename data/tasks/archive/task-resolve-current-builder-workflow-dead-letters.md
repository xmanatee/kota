---
status: done
---

# Resolve current builder workflow dead letters

## Problem

Investigate and clear the open builder workflow-dispatch dead letters where one builder run idled for an hour without runtime progress and another made no progress after repeated commit-stageable repair attempts. Determine whether stale claims, worktree state, staging behavior, or runtime progress signaling caused the failures, then fix, redrive, or dismiss with durable rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-30T17-00-27-958Z-progress-reviewer-ivps6m.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-30T17-00-27-958Z-progress-reviewer-ivps6m.

review verdict: needs-steering
review summary: Balance: Product 0, Safety 0, Platform 0, Meta 0, Unclassified 1. Security review is still producing actionable work, but three open workflow-dispatch dead letters keep the scope below healthy; the two builder failures need a normal follow-up.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-547d6311-4c9c-491f-a834-b94587f1af28
- scope:8nrg1m:dead-letter:dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-30T22-39-06-955Z-builder-ez3sip/dead-letter-resolution.md` records both cited DLQ items, the root causes, the superseding successful run for the idle-timeout item, the commit-stageable index-lock repair, and the sandbox limitation that prevented direct canonical dismissal.
- `src/modules/autonomy/commit.ts` now applies the existing Git index-lock retry behavior to `checkCommitStageable`, and persistent index locks produce a specific repair message instead of the misleading gitignore/path conflict message.
- `src/modules/autonomy/commit.test.ts` covers transient index-lock recovery for the repair-loop dry-run.
- Focused validation passed: `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/commit.test.ts src/modules/autonomy/commit-paths.test.ts`.
- Broader validation passed: `pnpm run typecheck`.
- Residual canonical cleanup was converted into `task-clear-stale-builder-dlq-items-after-repair-merge` because this builder worktree cannot write `/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json` and daemon-control HTTP connections from the active build step fail with `connect EPERM`.
