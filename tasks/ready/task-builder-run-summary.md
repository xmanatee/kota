---
id: task-builder-run-summary
title: Write structured run summary artifact at end of each builder run
status: ready
priority: p3
area: runtime
summary: Builder runs produce commits and .kota/runs/ directories but no human-readable summary of what was done. Operators and the improver must read raw conversation logs to understand what a builder run accomplished.
created_at: 2026-03-31T01:15:00Z
updated_at: 2026-03-31T01:43:23Z
---

## Problem

Each builder run produces a `.kota/runs/<run-id>/` directory with raw step output files, but no structured summary of the outcome. To understand what a builder run accomplished, an operator must:
1. Read the commit message (brief, often terse).
2. Dig through `step-build.json` conversation logs.

The improver workflow also reads this evidence, but has no quick entry point — it reconstructs context from raw logs on every run. A lightweight summary artifact would make operator review faster and give the improver a head start.

## Desired Outcome

At the end of a successful builder run, a `run-summary.json` file is written to the run directory (`.kota/runs/<run-id>/run-summary.json`) with:

```json
{
  "runId": "2026-03-31T...",
  "workflow": "builder",
  "taskId": "task-foo-bar",
  "taskTitle": "Add foo bar feature",
  "outcome": "success",
  "commitSha": "abc1234",
  "commitMessage": "...",
  "filesChanged": ["src/foo.ts", "src/bar.ts"],
  "costUsd": 0.42,
  "durationMs": 120000,
  "completedAt": "2026-03-31T01:30:00.000Z"
}
```

The summary is written as a final `code` step in the builder workflow after commit succeeds. It pulls from available step outputs and run context — no additional agent call is needed.

## Constraints

- Write as a `code` step after the commit step, not an agent step — no LLM cost.
- Use `typedCodeStep` for compile-time safety.
- File is advisory only; nothing downstream should fail if it is missing.
- `filesChanged` can use `git diff --name-only HEAD~1` or similar to list committed files.
- The summary is not exposed via the daemon API in this task — filesystem only.

## Done When

- Builder run directory contains `run-summary.json` after a successful run.
- Summary includes task ID and title (from the inspected queue step), commit SHA, changed files, cost, and duration.
- The step is skipped cleanly when the build step did not succeed (follows existing `when` guard pattern).
- At least one test or integration check verifies the file is written with the expected shape.
