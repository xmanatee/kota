---
id: task-split-workflowtypests-into-per-concern-sibling-fil
title: Split workflow/types.ts into per-concern sibling files
status: done
priority: p2
area: core
summary: src/core/workflow/types.ts is 795 lines mixing trigger/retry types, step input types, resolved step types, and workflow definition types — extract them into per-concern sibling files so each stays focused and under the file-size guideline.
created_at: 2026-05-06T03:22:52.025Z
updated_at: 2026-05-06T03:33:39.124Z
---

## Problem

`src/core/workflow/types.ts` is the largest file in `src/core/` at 795
lines and it carries 40 exported types covering several distinct
concerns:

- Trigger and retry shapes (`WorkflowRetryConfig`,
  `WorkflowAgentBackoffKind`, `WorkflowAgentBackoffState`,
  `WorkflowAgentBackoffSignal`, `WorkflowFilterScalar`,
  `WorkflowFilterValue`, `WorkflowTriggerInput`, `WorkflowTrigger`,
  `WorkflowRunTrigger`).
- Authoring step inputs (`WorkflowToolStepInput`,
  `WorkflowAgentStepInput`, `WorkflowEmitStepInput`,
  `WorkflowRestartStepInput`, `WorkflowCodeStepInput`,
  `TypedCodeStepInput`, `WorkflowTriggerStepInput`,
  `WorkflowParallelGroupInput`, `WorkflowBranchStepInput`,
  `WorkflowForeachStepInput`, `WorkflowApprovalStepInput`,
  `WorkflowAwaitEventStepInput`, `WorkflowStepInput`,
  `CodeStepOutputValidator`, `WorkflowNotifyConfig`).
- Resolved/runtime step shapes (`WorkflowToolStep`,
  `WorkflowAgentStep`, `WorkflowEmitStep`, `WorkflowRestartStep`,
  `WorkflowCodeStep`, `WorkflowTriggerStep`, `WorkflowParallelGroup`,
  `WorkflowBranchStep`, `WorkflowForeachStep`, `WorkflowApprovalStep`,
  `WorkflowAwaitEventStep`, `WorkflowStep`).
- Workflow definition shapes (`WorkflowDefinitionInput`,
  `WorkflowContributionSource`, `RegisteredWorkflowDefinitionInput`,
  `WorkflowDefinition`).

These concerns are independently navigable and tested. Co-locating
them in one 795-line file makes the workflow type surface harder to
read, harder to extend, and inconsistent with the established
per-concern split rhythm (recent: `workflow/validation.ts`,
`daemon-control-chat.ts`, `run-store-helpers.ts`,
`daemon-control-routes`, `WorkflowRuntime`, `step-executor-agent`,
`Daemon`, `ModuleLoader`, `McpServer`).

## Desired Outcome

`src/core/workflow/types.ts` is split into focused sibling files under
`src/core/workflow/` so each file owns one concern and stays under
the file-size guideline. A reasonable shape (the builder may adjust
groupings as long as each sibling is cohesive):

- `src/core/workflow/trigger-types.ts` — retry/backoff,
  filter, trigger inputs, resolved triggers, run triggers.
- `src/core/workflow/step-input-types.ts` — `*StepInput`
  family plus `WorkflowParallelGroupInput`,
  `CodeStepOutputValidator`, `WorkflowNotifyConfig`,
  `WorkflowStepInput` discriminated union.
- `src/core/workflow/step-types.ts` — resolved `*Step` shapes
  and `WorkflowStep` discriminated union.
- `src/core/workflow/types.ts` (kept) — authoring/registered
  workflow definition types only (`WorkflowDefinitionInput`,
  `WorkflowContributionSource`,
  `RegisteredWorkflowDefinitionInput`, `WorkflowDefinition`).

All importers update to the new module paths; no re-export shims, no
parallel public surfaces. Type names, fields, and semantics stay
unchanged.

## Constraints

- Do not change type names, fields, or semantics. Pure relocation
  plus import-path updates.
- No re-export shims from `workflow/types.ts` for relocated types.
  Importers update directly to the new sibling.
- Keep each new sibling cohesive and under the file-size guideline
  (~300 lines target; never higher than the original).
- Preserve existing inline JSDoc on every relocated type.
- Do not introduce a parallel barrel/index that re-exports the
  siblings as one bag. Same-directory siblings are imported
  directly.
- `npx tsc --noEmit` and the existing test suite must pass with no
  new errors.
- Run the autonomy-module test suite (`src/modules/autonomy/...`)
  in addition to the core suite to ensure workflow validation,
  step executor, and runtime dispatch keep typing correctly.

## Done When

- The new sibling files exist with the listed type families and
  preserve their original JSDoc.
- `src/core/workflow/types.ts` is reduced to definition types only
  and is well under the file-size guideline.
- No remaining file in the codebase imports relocated types from
  `#core/workflow/types.js` — all imports point at the correct
  sibling file.
- `pnpm typecheck` (or the equivalent) and the existing tests pass
  green on the resulting commit.

## Source / Intent

Continuation of the established per-concern split rhythm in `src/core/`.
`src/core/workflow/types.ts` is currently the largest file in the core
runtime kernel; splitting it advances the `src/AGENTS.md` directive that
"`src/core/` is the small runtime kernel" and avoids letting the largest
file in core continue to mix four independent concerns.

## Initiative

Minimal-core, module-first architecture: keep `src/core/` files focused
on a single concern so the runtime kernel stays small and readable.

## Acceptance Evidence

- Resulting commit shows `src/core/workflow/types.ts` reduced to
  definition types and new sibling files added under
  `src/core/workflow/`.
- Build/test transcript on the resulting branch confirms typecheck
  and tests pass green.
