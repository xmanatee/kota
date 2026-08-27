---
status: done
---

# Add workflow controls to the web UI (pause, resume, trigger)

## Problem

The web UI shows workflow run history and costs but has no action surface. Pausing a runaway workflow, resuming a paused one, or triggering a manual run all require CLI access today. This limits the utility of the web UI for operators who want to manage the system from the browser.

## Desired Outcome

The web UI should expose:
- **Pause / Resume** toggle per workflow (using the existing pause/resume HTTP endpoints)
- **Manual trigger** button to queue an immediate workflow run

## Constraints

- The HTTP API already supports pause, resume, and manual trigger — this is purely a UI addition.
- Keep controls visually minimal; place them near the workflow-level cost or run-list section.
- No new backend work required unless the existing endpoints are missing something.

## Done When

- Operators can pause and resume a workflow from the web UI.
- Operators can trigger a manual workflow run from the web UI.
- The UI reflects updated workflow state after each action.
