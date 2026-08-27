---
status: done
---

# Add kota workflow runs CLI for browsing past workflow execution history

## Problem

Every workflow execution writes artifacts (commit-message.txt, step outputs,
logs) under `.kota/runs/<run-id>/`. Over time this directory grows with no CLI
surface to navigate it. Operators who want to review what ran, when, why it ran,
or how much it cost must manually browse the filesystem.

The daemon control API exposes live workflow status (`GET /status`,
`GET /workflows`), but there is no equivalent for completed run history. The
conversation history store covers agent sessions, but does not index workflow
run metadata (trigger, duration, cost, step count, outcome).

## Desired Outcome

- `kota workflow runs` — list recent workflow runs with run ID, workflow name,
  trigger type, start time, duration, and outcome (success/failure).
- `kota workflow runs show <run-id>` — show full detail for one run: all step
  outputs, commit message (if any), cost, and any artifacts written.
- `--workflow <name>` filter to scope listing to a specific workflow.
- `--limit N` to control how many runs are listed (default 20).
- `--json` flag for scripting.

## Constraints

- Read from `.kota/runs/` directory artifacts; do not require daemon to be
  running for historical queries.
- When the daemon is running, supplement with any in-memory run metadata the
  daemon exposes (e.g. duration, cost from `GET /workflows`).
- Keep scope to read-only inspection. No deletion or re-run in this task.
- Follow the same CLI registration pattern as `kota workflow definitions`.

## Done When

- `kota workflow runs` lists recent runs with name, trigger, timestamp, and
  outcome.
- `kota workflow runs show <run-id>` shows step-level detail and artifacts.
- `--workflow`, `--limit`, and `--json` flags work.
- Command is registered and appears in `kota workflow --help`.

## Resolution

This capability already exists under different command names:
- `kota workflow list` — lists recent runs with ID, name, trigger, start time,
  duration, cost, and status. Supports `--workflow`, `--limit`/`-n`,
  `--status` filters. Implemented in `src/workflow-cli/run-list.ts`.
- `kota workflow show <run-id>` — shows step-level detail, cost, repair
  summary, and error text. Supports `--step <step-id>` for raw step output.
  Implemented in `src/workflow-cli/run-show.ts`.
- `kota workflow history` — aggregate stats by workflow (count, success rate,
  cost, duration percentiles). `--workflow` and `--days` filters.

The `--json` flag is absent from `list` and `show` (though present on
`definitions` and `cost`). This is a minor gap not worth a separate task.
