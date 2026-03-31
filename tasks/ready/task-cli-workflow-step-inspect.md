---
id: task-cli-workflow-step-inspect
title: Add kota workflow step-inspect command to view step output from a run
status: ready
priority: p3
area: cli
summary: There is no CLI command to inspect the output of a specific step within a completed run. Operators must locate the run directory and read raw JSON files to debug step outputs, which is tedious for runs with many steps.
created_at: 2026-03-31T15:07:46Z
updated_at: 2026-03-31T15:07:46Z
---

## Problem

`kota workflow show <run-id>` prints top-level run metadata and step statuses, but not the output of individual steps. Step outputs are stored in the run artifact directory (`<runDir>/steps/<step-id>/output.json`) and contain the model's raw response, tool calls made, cost breakdown, and other structured data. Accessing this requires knowing the `.kota/runs/` directory layout and manually reading files.

The `src/workflow-cli/run-show.ts` module already loads and displays run metadata; it does not expose step-level outputs.

## Desired Outcome

A `kota workflow step-inspect <run-id> <step-id>` command that:

- Loads the step's `output.json` from the run artifact directory.
- Pretty-prints the output as JSON (default) or a human-readable summary (`--format summary`).
- Exits with a non-zero code if the run ID or step ID doesn't exist.

Optionally, `kota workflow show <run-id> --steps` could expand to show all step outputs inline (stretch goal).

## Constraints

- Read-only: no changes to run artifacts or state.
- Follow the pattern in `src/workflow-cli/run-show.ts` for run directory resolution.
- Do not add new daemon API endpoints; read directly from the run artifact directory on disk.
- If the step has no output file (e.g., was skipped), print a clear message rather than an error.

## Done When

- `kota workflow step-inspect <run-id> <step-id>` prints the step output JSON.
- `--format summary` prints a concise human-readable summary.
- Command exits with non-zero code for unknown run or step IDs.
- Integration test or unit test covers the happy path and missing-step case.
