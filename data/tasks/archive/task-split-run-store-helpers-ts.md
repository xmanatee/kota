---
status: done
---

# Split workflow/run-store-helpers.ts (317 lines) — extract IO utilities

## Problem

`src/core/workflow/run-store-helpers.ts` is 317 lines. It mixes three concerns:
runtime-state validation and assertion (`assertWorkflowRuntimeState`, `assertWorkflowRunMetadata`),
generic file IO utilities (`ensureDir`, `safeJsonStringify`, `writeJsonFile`, `formatRunId`),
and snapshot/summary builders (`buildWorkflowSnapshot`, `summarizeStep`, `extractRepairSummary`).

## Desired Outcome

The file IO utilities (`ensureDir`, `safeJsonStringify`, `writeJsonFile`, `formatRunId`)
are extracted to a small `run-io.ts` module. `run-store-helpers.ts` imports from it.
Both files stay under 300 lines.

## Constraints

- Keep all public export names unchanged; update imports in files that use them
- Do not change file formats or directory behavior

## Done When

- `workflow/run-store-helpers.ts` is under 300 lines.
- All existing tests pass.
- Type checking and lint pass.
