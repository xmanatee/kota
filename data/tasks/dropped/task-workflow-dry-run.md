---
id: task-workflow-dry-run
title: Add workflow dry-run mode to validate definitions without executing steps
status: dropped
priority: p3
area: runtime
summary: Operators cannot test a workflow definition without triggering a real run. A dry-run mode would validate the definition, resolve triggers, and report what steps would execute — without invoking any agents, tools, or side effects.
created_at: 2026-03-31T05:28:00Z
updated_at: 2026-03-31T06:00:00Z
---

## Why Dropped

Dropped in `9d8d4f2e` because workflow dry-run exists now. The current
workflow-ops execution path includes `src/modules/workflow-ops/execution/dry-run.ts`,
`kota workflow run --dry-run`, daemon dry-run support, and tests for validation
and output formatting. The original operator need is covered.

## Problem

Authoring a new workflow or modifying step conditions requires a live run to verify
behavior. There is no way to:
- Check that a workflow definition passes validation without loading the full daemon.
- See which steps would run given a specific trigger event and prior step outputs.
- Verify `when` predicates and `continueOnFailure` settings without actually failing a step.

The `kota config validate` pattern exists for config. A parallel `kota workflow dry-run`
would close the same gap for workflow definitions, reducing the edit-commit-fail loop.

## Desired Outcome

`kota workflow dry-run <workflow-name> [--trigger-event <event>] [--trigger-payload <json>]`
validates and simulates a named workflow without executing any steps:

1. Loads the workflow definition from the manifest.
2. Runs the full validation pass (`validation.ts`) and reports errors.
3. Walks the step list in order, evaluating `when` predicates against a simulated context
   (all prior step outputs are `undefined`/`null`), and prints which steps would run,
   which would be skipped, and which have retry or timeout config.
4. Does not invoke any tool, agent, or code step. Emits no bus events.
5. Prints a summary table: step ID, type, status (would-run / would-skip / validation-error),
   and any relevant config (retry, timeout, continueOnFailure).

## Constraints

- No network calls, no daemon connection required — works fully offline.
- `when` predicates are evaluated with a stub context (empty `stepOutputs`, null
  `previousOutput`); the goal is to detect obvious dead code, not fully simulate runtime.
- Report validation errors and would-skip steps clearly so authors don't need to run
  the real workflow to find basic mistakes.
- Register under `kota workflow dry-run` alongside existing `kota workflow` subcommands.
- Do not execute any `run` function from code steps, even for validation.

## Done When

- `kota workflow dry-run <name>` validates and prints a step walk for the named workflow.
- Validation errors (missing fields, bad trigger config) are reported before the step walk.
- Steps whose `when` predicate returns false given an empty context are flagged as "would-skip (when=false)".
- At least one test covers the dry-run output format and validation error reporting.
- Command appears in `kota workflow --help`.
