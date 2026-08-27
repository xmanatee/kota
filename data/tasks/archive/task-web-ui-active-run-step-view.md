---
status: done
---

# Show active step progress in web UI run detail view

## Problem

The web UI run detail view streams live logs but gives no structural view of step execution. When a run is in progress, operators cannot tell which step is active or how many remain. They must read raw log output to infer progress.

## Desired Outcome

The run detail page includes a step-progress component:

- Lists all steps defined in the workflow (in execution order)
- Shows status for each step: pending, running, success, failed, skipped
- Highlights the currently-executing step
- Updates live for in-progress runs (same mechanism as live log streaming)

## Constraints

- The workflow definition and per-step status are already tracked in run state — this is a display-only change
- Do not add new backend state; derive step status from existing run directory artifacts
- Should degrade gracefully for completed runs (all steps resolved)

## Done When

- Run detail page shows a step-progress panel alongside (or above) the log stream
- Active step is visually distinct during live runs
- Step statuses reflect final outcome on completed or failed runs
