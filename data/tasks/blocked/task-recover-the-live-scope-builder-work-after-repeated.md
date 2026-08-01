---
id: task-recover-the-live-scope-builder-work-after-repeated
title: Recover the live-scope builder work after repeated continuation timeouts
status: blocked
priority: p1
area: autonomy
task_class: Meta
summary: Inspect and preserve the existing live-scope lifecycle worktree, diagnose why both the original builder and its recovery continuation consumed the full active-runtime budget after producing implementation and evidence, then complete or explicitly supersede the work through the supported state-recovery path without duplicating the underlying task.
created_at: 2026-08-01T07:56:45.249Z
updated_at: 2026-08-01T08:35:20.947Z
---

## Problem

    Inspect and preserve the existing live-scope lifecycle worktree, diagnose why both the original builder and its recovery continuation consumed the full active-runtime budget after producing implementation and evidence, then complete or explicitly supersede the work through the supported state-recovery path without duplicating the underlying task.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-31T19-51-10-297Z-progress-reviewer-op4plx.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-31T19-51-10-297Z-progress-reviewer-op4plx.

review verdict: blocked
review summary:

    The 24-hour window delivered Product and Safety outcomes, but progress is now blocked by two consecutive six-hour builder timeouts on the same P1 live-scope lifecycle task. Task-class balance is Product 7, Safety 2, Platform 11, Meta 0.

Evidence ids:

- scope:8nrg1m:task:task-make-directory-scope-registration-a-live-daemon-li
- scope:8nrg1m:run:2026-08-01T01-53-28-244Z-builder-6j5fbm
- scope:8nrg1m:dead-letter:dlq-3958c3f9-fa95-44aa-b9df-1dbde864502d
- scope:8nrg1m:dead-letter:dlq-42194fd1-b39a-4577-adaf-15a0d1d448ef

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A run artifact records state-recovery and dead-letter state before and after remediation; all unique preserved changes are reviewed and either validated and landed through the guarded builder path or explicitly superseded with rationale; the live-scope lifecycle task is done or safely claimable; both cited dead letters have terminal dispositions; and a focused regression fixture demonstrates that a preserved-work continuation cannot repeat the observed unbounded timeout without producing a bounded, actionable recovery result.

## Status (2026-08-01 bounded recovery)

The repeated timeout was reproduced in code: the builder terminal finalizer
explicitly made an active-runtime timeout from a preserved-work continuation
eligible for another continuation. The finalizer now emits no second recovery
request, writes a typed `state-recovery-required` action with inspect/resolve
commands, and the recovery scan honors that terminal decision. Focused tests
cover both boundaries.

The preserved live-scope attempt was reviewed before disposition. It contains
191 staged paths, two later tracked edits, and seven untracked split files; the
staged patch has SHA-256
`d6759635b00e8ebd9beac4cf7a39fcfddba38b9f1430ab3cb9b568bd93bceada`.
Both critic runs failed. Later repairs reported passing validation but never
received a post-repair critic verdict, and the real host index omitted the
seven final files. The exact before state and review rationale are preserved in
this run's `recovery-before.json` artifact.

The supported supersede command was attempted against only the cited stale
claim/worktree and its linked DLQs. The builder sandbox rejected the canonical
`.kota/worktrees` write with `EPERM` before any mutation, while its network
namespace could not reach the already-running loopback daemon. The repository
fix is validated, but the external runtime disposition therefore remains
blocked and is recorded without claiming completion in `recovery-after.json`.

Verification:

- `vitest` focused recovery/state-recovery set: 5 files, 23 tests passed.
- Direct TypeScript typecheck passed.
- Biome check over the three changed TypeScript files passed.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-08-01T08-14-32-218Z-builder-a76oy9/workflow-state-recovery.json
description: trusted canonical-host state-recovery evidence — run the exact hostReplay command recorded in this builder run's recovery-after.json from /Users/xmanatee/Desktop/mono/apps/kota, then capture the successful workflow-state-recovery.json proving the stale claim was superseded, both cited timeout DLQs were dismissed, only the exact preserved worktree was removed, and the underlying live-scope task is safely claimable
```
