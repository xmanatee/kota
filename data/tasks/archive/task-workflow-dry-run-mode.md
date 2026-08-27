---
status: done
---

# Add --dry-run flag to kota workflow run for step validation

## Problem

When editing a workflow definition, there is no way to verify that the step
graph is correct (step IDs, `when` predicates, parallel grouping) without
actually running the workflow and waiting for an agent step to execute.
Mistakes in `when` conditions or step ordering only surface at runtime after a
run directory is created and a step has already started.

## Desired Outcome

- `kota workflow run <workflow> --dry-run` loads and validates the workflow definition.
- Prints the resolved execution plan, including step order, skipped steps (for `when` predicates evaluated against empty context), and parallel groups.
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
