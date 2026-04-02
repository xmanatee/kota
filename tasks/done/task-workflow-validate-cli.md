---
id: task-workflow-validate-cli
title: Add kota workflow validate command for CI and pre-commit checks
status: done
priority: p3
area: cli
summary: There is no standalone command to validate workflow definitions without triggering or running them. A `kota workflow validate` command that loads definitions, runs validation, and exits non-zero on errors would enable CI and pre-commit hooks to catch workflow definition mistakes early.
created_at: 2026-04-02T05:47:58Z
updated_at: 2026-04-02T06:47:00Z
---

## Problem

`validateWorkflowDefinitions` is called implicitly by `kota workflow run`, `kota workflow trigger`,
and `kota workflow definitions`, but there is no command that only validates and exits. Teams that
want to fail a CI step or a git pre-commit hook when a workflow definition has errors must either:
- Trigger a workflow (with side effects), or
- Parse error output from `kota workflow definitions` and treat non-zero as failure.

Neither is a clean, intent-signaling primitive. The validation logic already exists; it just needs
a CLI surface.

## Desired Outcome

`kota workflow validate [--workflow <name>]` that:
- Loads all workflow definitions from the configured source (same path as `kota workflow definitions`).
- Runs `validateWorkflowDefinitions` on them.
- Prints a per-definition result (name + PASS or FAIL + error message).
- Exits 0 if all definitions are valid; exits non-zero if any fail.
- Accepts an optional `--workflow <name>` flag to validate a single definition by name.

## Constraints

- No daemon required; reads definitions statically, like `kota workflow definitions`.
- Does not trigger or run any workflow.
- Output format is human-readable by default; `--json` flag outputs structured results.
- Reuse `validateWorkflowDefinitions` from `src/workflow/validation.ts` without modification.

## Done When

- `kota workflow validate` runs without a daemon and exits 0 when all definitions pass.
- Exits non-zero and prints error details when any definition fails validation.
- `--workflow <name>` flag filters to a single definition.
- `--json` flag outputs a structured JSON array of `{ name, valid, error? }` objects.
- A unit test covers the pass and fail cases.
