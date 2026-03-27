---
id: task-workflow-dry-run-mode
title: Add --dry-run flag to kota workflow run for step validation
status: backlog
priority: p3
area: workflow
summary: kota workflow run --dry-run should validate the workflow definition and simulate step execution order (including when predicates and parallel blocks) without running agent steps or executing consequential code. Useful for testing workflow changes before deploying them.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

When editing a workflow definition, there is no way to verify that the step graph is correct (step IDs, `when` predicates, parallel grouping) without actually running the workflow and waiting for an agent step to execute. Mistakes in `when` conditions or step ordering only surface at runtime.

## Desired Outcome

- `kota workflow run <workflow> --dry-run` loads and validates the workflow definition.
- Simulates the execution plan: prints the resolved step order, which steps would be skipped (due to `when` predicates evaluated against empty context), and which steps are parallel.
- Code steps are validated (syntax/import check) but not executed.
- Agent steps are listed with their model/tool config but not started.
- Exits with a non-zero code if the definition is invalid.

## Constraints

- Dry-run must not invoke any external services, write to the run store, or touch `.kota/runs/`.
- `when` predicates are evaluated against an empty `stepOutputs` map; expected skip behavior should be noted in output.
- Keep implementation in the workflow CLI layer; do not add dry-run conditionals to `run-executor.ts`.

## Done When

- `kota workflow run <workflow> --dry-run` prints the resolved step plan without executing.
- Invalid step references or malformed `when` predicates produce clear errors.
- No run directory is created during a dry run.
- Tests cover: valid workflow prints plan, invalid step reference errors, `when` predicate evaluation noted.
