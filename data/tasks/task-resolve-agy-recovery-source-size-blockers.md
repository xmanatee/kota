---
status: open
priority: p2
---

# Resolve AGY recovery source-size blockers

## Problem

The AGY reliability recovery commit `2d15ad78a` preserved useful telemetry,
sandbox, repair-loop, and builder-preflight changes, but its source-size review
blocked the task because it touched four oversized files:
`src/core/workflow/run-executor-step.ts` (542 lines),
`src/core/workflow/run-executor.test.ts` (1,271),
`src/modules/antigravity-cli-agent-harness/adapter.test.ts` (681), and
`src/modules/autonomy/autonomous-loop.integration.test.ts` (603). Leaving the
debt only inside a historical run artifact makes the blocker undispatchable and
encourages future broad edits in already overloaded ownership surfaces.

## Desired Outcome

Split the four cited files at cohesive execution, harness, and scenario
boundaries so each owner is focused and the severe source-size review clears,
without changing the recovered runtime behavior.

## Constraints

- Preserve the behavior and evidence introduced by `2d15ad78a`; this is a
  structural cleanup, not an opportunity to redesign AGY or repair semantics.
- Reuse existing module patterns and test support. Do not create generic helper
  buckets, duplicate fixtures, or move assertions away from their owner.
- Delete superseded exports and imports in the same change; no compatibility
  re-exports.

## Done When

- Each cited production/test file is below the repository guideline or has
  been replaced by focused files with clear ownership and no oversized-batch
  result.
- Relevant run-executor, AGY adapter, repair telemetry, runtime-write boundary,
  and autonomous-loop behaviors remain covered.
- A fresh source-size artifact reports no severe blocker for the cleanup diff.
- Structural search finds no duplicate test scenarios or abandoned helper
  files from the split.

## Source / Intent

Created from the owner-requested review on 2026-08-13. Canonical evidence is
`.kota/runs/2026-08-11T12-06-15-974Z-builder-2ztd9j/source-file-size-review.json`.

## Initiative

Maintainable native-agent recovery runtime.

## Acceptance Evidence

- Before/after line-count and ownership map for all four cited files.
- Focused behavior transcript and fresh source-size review artifact.
