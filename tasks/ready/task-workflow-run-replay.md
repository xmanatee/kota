---
id: task-workflow-run-replay
title: Replay a completed workflow run with its original trigger payload
status: ready
priority: p3
area: operator-ux
summary: Operators iterating on workflow definitions must manually re-trigger runs with the correct payload. A replay command that re-fires a past run using the recorded trigger payload would tighten the edit-test loop.
created_at: 2026-04-01T02:26:00Z
updated_at: 2026-04-01T02:26:00Z
---

## Problem

When an operator modifies a workflow definition after a failed or unexpected run, they must
manually re-trigger the workflow — either via `kota workflow trigger` with the correct
`--payload` flag, or by waiting for the natural trigger to fire again. Reconstructing the
original payload from `.kota/runs/` artifacts requires reading run records by hand.

There is no `kota workflow replay <run-id>` command, and the web UI run detail view has no
replay button.

## Desired Outcome

A `kota workflow replay <run-id>` command that:
1. Reads the trigger payload and workflow name from the stored run record.
2. Posts a new trigger to `POST /workflow/trigger` with the same payload.
3. Prints the new run ID.

A "Replay" button in the web UI run detail view that performs the same action and shows the
new run ID or navigates to it.

## Constraints

- Replay creates a new run; it does not overwrite or mutate the original run record.
- If the workflow definition no longer exists, the command fails with a clear error.
- The replayed run's trigger event is `workflow.replay` (or the original event type, clearly
  documented) so operators can distinguish replayed runs in history.
- Workflow must not be paused or the daemon must be running; follow the same pre-conditions
  as `kota workflow trigger`.
- Document the command in `docs/WORKFLOWS.md`.

## Done When

- `kota workflow replay <run-id>` triggers a new run using the stored payload and prints
  the new run ID.
- The web UI run detail panel shows a "Replay" button that calls the replay endpoint.
- The replayed run appears in workflow history with a distinguishable trigger label.
- The command fails gracefully if the run record or workflow definition is missing.
