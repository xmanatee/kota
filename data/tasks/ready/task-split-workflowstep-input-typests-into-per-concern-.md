---
id: task-split-workflowstep-input-typests-into-per-concern-
title: Split workflow/step-input-types.ts into per-concern sibling files
status: ready
priority: p2
area: core
summary: src/core/workflow/step-input-types.ts is 439 lines mixing simple step input shapes, code-step output validators with helpers and an error class, and control-flow/synchronization step input shapes — extract them into per-concern sibling files so each stays focused and the largest non-test file in src/core/workflow/ drops below the recently-completed split tier.
created_at: 2026-05-06T03:58:11.552Z
updated_at: 2026-05-06T03:58:11.552Z
---

## Problem

`src/core/workflow/step-input-types.ts` is 439 lines and currently the
largest non-test, non-pure-types file under `src/core/workflow/` after
the recent `workflow/types.ts` split (commit `83c34127`) and
`workflow/validation.ts` split (commit `194ba74c`). It bundles three
independently navigable concerns:

- Simple step input shapes: `WorkflowBaseStep`, `WorkflowToolStepInput`,
  `WorkflowAgentStepInput`, `WorkflowEmitStepInput`,
  `WorkflowRestartStepInput`, plus the cross-cutting
  `WorkflowNotifyConfig` notification type.
- Code-step output validation: `CodeStepOutputValidator` type,
  `expectStructuredOutput` and `expectArrayOutput` helper functions,
  `WorkflowCodeStepInput` and `TypedCodeStepInput` shapes,
  `WorkflowStepOutputValidationError` class, and the `typedCodeStep`
  helper builder. This is real logic — not just types — and is
  orthogonal to the rest of the file.
- Control-flow and synchronization step input shapes:
  `WorkflowTriggerStepInput`, `WorkflowParallelGroupInput`,
  `WorkflowBranchStepInput`, `WorkflowForeachStepInput`,
  `WorkflowApprovalStepInput`, `WorkflowAwaitEventStepInput`.

Co-locating them in one 439-line file makes the step-input surface
harder to read and harder to extend, and is inconsistent with the
established per-concern split rhythm under `src/core/workflow/`
(`trigger-types.ts`, `step-types.ts`, the `validation-*.ts` siblings,
the `step-validators/` directory).

## Desired Outcome

`src/core/workflow/step-input-types.ts` is split into focused sibling
files under `src/core/workflow/` so each file owns one concern and
stays under the file-size guideline. A reasonable shape (the builder
may adjust groupings as long as each sibling is cohesive):

- `src/core/workflow/step-input-base.ts` — `WorkflowBaseStep`,
  `WorkflowToolStepInput`, `WorkflowAgentStepInput`,
  `WorkflowEmitStepInput`, `WorkflowRestartStepInput`,
  `WorkflowNotifyConfig`.
- `src/core/workflow/step-input-code.ts` — `CodeStepOutputValidator`,
  `expectStructuredOutput`, `expectArrayOutput`,
  `WorkflowCodeStepInput`, `TypedCodeStepInput`,
  `WorkflowStepOutputValidationError`, and the `typedCodeStep`
  helper plus its private `decodeStepOutput` companion.
- `src/core/workflow/step-input-control-flow.ts` —
  `WorkflowTriggerStepInput`, `WorkflowParallelGroupInput`,
  `WorkflowBranchStepInput`, `WorkflowForeachStepInput`,
  `WorkflowApprovalStepInput`, `WorkflowAwaitEventStepInput`.
- `src/core/workflow/step-input-types.ts` (kept) — the
  `WorkflowStepInput` discriminated union only, importing each step
  input shape directly from its sibling. No re-export shims for
  relocated symbols.

All importers update to the new module paths. Type names, fields,
runtime behavior, and JSDoc stay unchanged.

## Constraints

- Pure relocation plus import-path updates. Do not change type names,
  fields, helper signatures, error class shape, or runtime behavior.
- No re-export shims from `step-input-types.ts` for relocated symbols.
  Importers update directly to the new sibling.
- Keep each new sibling cohesive and under the file-size guideline
  (~300 lines target; never higher than the original 439).
- Preserve existing inline JSDoc on every relocated symbol verbatim.
- Do not introduce a parallel barrel/index that re-exports the
  siblings as one bag. Same-directory siblings are imported directly.
- `pnpm typecheck` and the existing test suite must pass with no new
  errors. Run the workflow and autonomy module test suites in addition
  to the core suite to ensure validators, runtime dispatch, and
  workflow definitions keep typing correctly.

## Done When

- The new sibling files exist with the listed symbol families and
  preserve their original JSDoc.
- `src/core/workflow/step-input-types.ts` is reduced to the
  `WorkflowStepInput` discriminated union (and its direct imports
  from siblings) and is well under the file-size guideline.
- No file in the codebase imports a relocated symbol from
  `#core/workflow/step-input-types.js` — every import points at the
  correct sibling file.
- `pnpm typecheck` and `pnpm test` (or the equivalent project
  commands) pass green on the resulting commit, including the
  workflow and autonomy test suites.

## Source / Intent

Continuation of the recent per-concern split rhythm inside
`src/core/` (workflow/types.ts, workflow/validation.ts,
daemon-control-chat.ts, run-store-helpers.ts, daemon-control-routes,
WorkflowRuntime, step-executor-agent, Daemon, ModuleLoader,
McpServer). After the workflow/types.ts split landed, this file is
the largest remaining single-concern-mixing file under
`src/core/workflow/`. The strategic goal in `src/AGENTS.md` is to
keep `src/core/` a small protocol-oriented kernel; this split
advances that by making the step-input surface easier to navigate and
extend.

## Initiative

Module-first / core-shrinking: keep `src/core/` files focused on one
concern each so the kernel's protocol surface remains readable and
the per-concern boundaries are obvious to both human contributors
and autonomous builders.

## Acceptance Evidence

- The resulting commit shows the new sibling files exist with the
  expected concern split, the kept `step-input-types.ts` reduces to
  the discriminated union and direct imports, and no importer still
  pulls relocated symbols from the old module path.
- `pnpm typecheck` and `pnpm test` outputs in the run directory
  prove the suites pass green after the split.
