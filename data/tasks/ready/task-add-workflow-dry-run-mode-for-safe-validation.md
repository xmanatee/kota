---
id: task-add-workflow-dry-run-mode-for-safe-validation
title: Add workflow dry-run mode for safe validation
status: ready
priority: p2
area: workflows
summary: Operators have no way to validate a workflow definition end-to-end without actually executing it. A dry-run mode would resolve trigger predicates, enumerate steps, check tool availability, and report the plan without side effects.
created_at: 2026-04-12T16:39:24.627Z
updated_at: 2026-04-12T16:39:24.627Z
---

## Problem

When an operator edits a workflow definition — changing triggers, adding steps,
adjusting tool scopes — there is no way to verify the result without running it
for real. A misconfigured trigger predicate, a missing tool, or a bad step
reference only surfaces at runtime, potentially wasting a full agent session
and leaving a failed run artifact.

The earlier `task-workflow-dry-run` was dropped, but the need persists: the
autonomy loop now runs dozens of workflows daily, and configuration errors are
costly to debug after the fact.

## Desired Outcome

A `--dry-run` flag on `kota workflow run` (and an equivalent daemon API
parameter) that:
- Resolves the trigger predicate against a provided or synthetic payload.
- Walks each step in order, validating tool/agent availability and step config.
- Reports the execution plan (step names, agents, tool scopes, estimated cost
  if the forecast endpoint is available) without invoking any agent sessions.
- Exits with a clear pass/fail and structured JSON output.

## Constraints

- Must not create a run directory, emit bus events, or mutate any state.
- Reuse existing workflow validation and cost forecast logic where possible.
- The dry-run path should be a mode of the existing run machinery, not a
  parallel implementation.
- Keep the CLI surface minimal: `kota workflow run <name> --dry-run [--payload '{}']`.

## Done When

- `kota workflow run <name> --dry-run` prints a structured execution plan and exits 0 on success.
- Missing tools, invalid step config, or unresolvable triggers cause exit 1 with diagnostic output.
- Daemon API accepts a `dryRun` parameter on the workflow run endpoint.
- Tests cover valid workflow, missing-tool, and bad-trigger cases.
