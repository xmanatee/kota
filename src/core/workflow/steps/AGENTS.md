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

## Agent writeScope: declare → enforce → fail

Every `AgentDef` declares a `writeScope` listing the tracked-file paths that
agent may mutate (path prefixes or exact file paths, relative to the project
directory). An empty array is the explicit "unrestricted" declaration; absence
is not — the field is required so silence cannot mean "write anywhere".

At the end of every agent step, `agent-write-scope.ts` diffs the worktree
against `HEAD` and compares touched paths to the declared scope. Any mutation
outside scope throws `AgentWriteScopeViolationError` and writes
`<runDir>/steps/<stepId>.write-scope-violation.json` with the offending paths.
The violation is a hard step failure — not classified as transient, so no
retries are consumed. Recovery from a dirty worktree then runs through the
existing `runtime.recovered` path.

This enforcement lives in the core executor, not in per-workflow prompts or
repair checks. Workflows declare scope honestly on their agent definitions
and let the runtime reject out-of-scope writes uniformly.
