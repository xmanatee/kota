---
id: task-prove-agy-builder-parity-end-to-end
title: Prove AGY builder parity end to end
status: backlog
priority: p1
area: architecture
task_class: Platform
depends_on: [task-execute-agy-model-benchmark-and-document-routing-d, task-recover-agy-builder-completion-reliability-from-th]
summary: Run a representative KOTA builder task through AGY with inspectable planning, edits, verification, commit, task transition, and cleanup evidence.
created_at: 2026-08-07T01:04:38.779Z
updated_at: 2026-08-24T03:03:20.000Z
---

## Problem

KOTA can register and preflight the Antigravity adapter, and lightweight AGY
agent steps have completed, but the existing preset parity test can pass a
harness-managed preset after observing only the model banner. It does not
require a successful response, tool use, scoped edit, verification, commit,
task transition, or cleanup. The generic all-harness parity task is also
blocked on unrelated provider credentials and therefore cannot establish AGY
builder readiness for this rollout.

## Desired Outcome

Add an AGY-specific scenario to the existing harness-parity mechanism that
executes the real KOTA builder workflow against a deterministic repository
fixture. The artifact must show the same prompt and acceptance contract going
through task claim, worktree preparation, AGY planning/tool use, scoped edits,
verification, KOTA-owned commit, task completion, and recovery cleanup.

The gate evaluates observable behavior. It must not pass merely because a
configured model string appears in a banner or source object.

## Constraints

- Build on the existing harness-parity runner and builder workflow; do not add
  a parallel benchmark framework or a test-only builder implementation.
- Keep the scenario isolated from the live task queue and canonical checkout.
- Require actual successful terminal output for harness-managed authentication.
- Record and fail on unrelated changed paths, ignored fixture instructions,
  missing final verification, stale claims/worktrees, and silent fallback.
- Do not require credentials for unrelated providers to run the AGY scenario.

## Done When

- One operator-runnable command executes the AGY builder parity scenario from
  start to final cleanup.
- The scenario fails if AGY exits without a final response, edits outside the
  requested scope, skips verification, uses a different model/effort, or leaves
  recovery state behind.
- The successful artifact records prompt, instructions/examples provided,
  observed model/effort, event trace, diff, verification, commit, task state,
  claim state, worktree state, and recovery projection.
- The generic parity gate reuses the same behavior assertions where applicable
  rather than maintaining weaker harness-managed-auth assertions.

## Source / Intent

Owner direction on 2026-08-07: end-to-end AGY builder parity is unproven and
must be thoroughly checked before a continuous AGY daemon is trusted.

The original routing-validation predecessor was deliberately decomposed and
dropped. The hard edge now targets its terminal benchmark-and-routing
successor, so future validation fails if an open task ever points at a dropped
predecessor again.

This is a focused unblocker for AGY. It complements rather than duplicates
`task-add-cross-preset-runtime-parity-gate` and
`task-capture-an-end-to-end-coding-task-parity-artifact-`, whose scope covers
all providers and currently depends on operator-controlled external captures.

## Initiative

Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- `.kota/runs/<run-id>/harness-parity/antigravity-cli/` containing the full
  builder lifecycle transcript and machine-readable parity verdict.
- A negative fixture proving that a rushed, unrelated, or unverified change is
  rejected even when AGY exits successfully.
