---
id: task-workflow-run-http-api
title: Expose workflow run status via HTTP API and web UI panel
status: done
priority: p2
area: workflow
summary: The web UI is a chat interface with no visibility into autonomous workflow activity. Adding HTTP endpoints for run status and a lightweight workflow panel in the web UI would let users monitor active and recent runs without the CLI.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Workflow runs are only visible through `kota workflow status` and `kota workflow runs` CLI commands. The HTTP server has no workflow-related endpoints, and the web UI shows no autonomous activity. Users who open the web interface have no way to see what KOTA is doing, how much it has cost, or whether a run succeeded or failed.

## Desired Outcome

- A `GET /api/workflow/status` endpoint returns the current runtime state: active run IDs, workflow names, start times, and queued counts.
- A `GET /api/workflow/runs` endpoint returns a paginated list of recent completed runs with ID, workflow, status, durationMs, and totalCostUsd.
- A `GET /api/workflow/runs/:runId` endpoint returns full step-level detail for a specific run (same data as `kota workflow show`).
- The web UI sidebar or a dedicated panel shows active runs (live-updating via polling or SSE) and a recent runs list.
- Each run entry in the UI shows workflow name, status badge, duration, and cost.

## Constraints

- Use the existing `WorkflowRunStore` to read run data; do not duplicate storage logic.
- The runtime state endpoint reads from the in-memory `WorkflowRuntime` via the existing event bus or a shared reference; no new global state.
- Keep the web UI panel lightweight — no new build toolchain. Extend the existing embedded JS/CSS approach.
- Polling interval for active runs in the UI should be 5s or less; SSE is preferred if straightforward.
- Do not expose sensitive step outputs (e.g., agent message content) in the list endpoint — summary fields only.

## Done When

- `/api/workflow/status` and `/api/workflow/runs` endpoints exist and return correct data.
- The web UI displays active runs and a recent runs list that refreshes automatically.
- Unit tests cover the new route handlers.
- The feature works when the daemon is running with `maxConcurrentRuns > 1`.
