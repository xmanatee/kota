# Decomposer Workflow

This directory contains the decomposer workflow definition and its prompt.

- Triggers on builder failure events and classifies structured timeout or
  exhausted repair outcomes.
- Reads the exact task id from the failed run's `task-claim.json`. When that
  task remains active, its canonical markdown is included in the assessment
  and the agent returns a typed decomposition plan without mutating the checkout.
- `review-decomposition` independently compares the plan with that exact task
  markdown. The planner output uses the workflow's canonical exposed-output
  channel; a rejection fails before any task mutation.
- `apply-decomposition` is the only mutation path: it creates the planned ready
  tasks through the repo-task writer, records dependencies, annotates the
  original, and moves it to `dropped/` through the task state machine.
- After the task-state commit, decomposer supersedes the failed builder's
  `pending-decomposition` claim. This is the canonical success path that
  reopens dispatch after a clean timeout or exhausted repair.
- `checkDecompositionApplied` verifies the dropped original and every ready
  subtask named by its `## Decomposed` section belong to the current mutation
  set before the workflow commits.
- A terminal or missing claimed task is newer canonical evidence than the
  failed builder run, so the workflow skips it instead of creating stale work.
- Keep decomposition logic inside this module, not in core or in the builder itself.
