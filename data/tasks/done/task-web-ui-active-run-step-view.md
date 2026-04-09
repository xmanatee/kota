---
id: task-web-ui-active-run-step-view
title: Show active step progress in web UI run detail view
status: done
priority: p2
area: web-ui
summary: The run detail page shows logs but not which step is currently executing. Adding a step-progress section — listing all steps with status icons (pending / running / done / failed) and highlighting the active step — would let operators know at a glance where a run is in its lifecycle without reading raw logs.
created_at: 2026-03-27
updated_at: 2026-03-27
---

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
