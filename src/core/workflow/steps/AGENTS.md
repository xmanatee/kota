# Step Executors

This directory contains the step execution strategy implementations and step
context construction.

- `step-executor.ts` is the entry point: it dispatches to the correct step type
  handler and exports shared helpers (`shouldRunStep`, `resolveValue`,
  `executeCodeStep`).
- Each `step-executor-<type>.ts` implements one step type strategy (agent,
  approval, branch, foreach, parallel, retry classification, trigger).
- `step-context.ts` constructs the `WorkflowStepContext` passed to step
  runners.

New step types add a new strategy file here and a dispatch case in
`step-executor.ts`.
