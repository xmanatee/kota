# builder-multi-point-wiring

## Source

- Run id: `2026-04-13T13-59-56-234Z-builder-gofonh`
- Workflow: `builder`
- Task: `task-enforce-strict-module-tool-metadata` (the real run's task
  asked for full wiring of `moduleMonitoring` through parsing,
  merging, schema, docs, and tests).

## What failed

The critic rejected the run with a single critical issue: one of the
explicitly-enumerated integration points (`moduleMonitoring` in
`mergeConfigs`) was missing. Every other integration point in the
task's "Done When" had been addressed, so the change looked complete
at a glance, but the contract required *all* of them. Missing one
falls under the demystifying-evals "partial wiring" failure mode that
artifact-level predicates exist to catch.

## Why this fixture captures it

The fixture gives the builder a task with seven deterministic
"Done When" points: three marker files and three substring checks
against `data/markers/INDEX.md`, plus the task file move. Each
enumerated point maps directly to one fixture predicate. If the agent
ships two markers without touching the INDEX, or updates the INDEX
only for one of the three markers, the corresponding predicate fails —
the same shape as the real run's critic rejection, but now observable
at the harness layer without a human reviewer.
