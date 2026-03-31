---
id: task-mcp-server-resources
title: Expose workflow and task queue state as MCP resources
status: backlog
priority: p3
area: runtime
summary: The KOTA MCP server exposes tools but no resources. Adding resources for workflow status, active runs, and the ready task queue lets MCP hosts (Claude Code, Cursor) read live KOTA state without a separate API call.
created_at: 2026-03-31T02:42:57Z
updated_at: 2026-03-31T02:42:57Z
---

## Problem

KOTA's MCP server exposes tools but does not implement `resources/list` or
`resources/read`. MCP clients that want to read live KOTA state (task queue,
workflow status, recent run history) must call the daemon control API directly,
which requires knowing the port and token from `daemon-control.json`. There is
no first-class read path through the MCP connection that's already open.

## Desired Outcome

The MCP server gains a small set of read-only resources:

- `kota://tasks/ready` — list of tasks in `tasks/ready/` with id, title, priority, and summary.
- `kota://workflow/status` — current paused state, active run count, and per-workflow last-run status (proxied from the daemon if available, or from the local `WorkflowRunStore` if not).
- `kota://workflow/runs/recent` — the 10 most recent run summaries (id, workflow, status, cost, duration).

Resources are static (no subscriptions in this task). Clients call `resources/read`
with the URI to fetch current state.

## Constraints

- Follow the MCP `resources/list` and `resources/read` JSON-RPC methods as defined in the MCP spec.
- Resources should read from disk / local stores directly; do not add a daemon dependency (daemon may not be running when the MCP server is used standalone).
- Keep `McpServer` options backwards-compatible; resource support should be addable via an opt-in `resources?: boolean` flag or always-on if lightweight.
- No new npm dependencies.
- Add entries to `docs/DAEMON-API.md` or a new `docs/MCP.md` documenting the resource URIs.

## Done When

- `resources/list` returns the three URIs described above.
- `resources/read` returns current data for each URI in MCP `text` content blocks.
- Existing tool tests pass; new tests cover `resources/list` and at least one `resources/read` call.
- Resource URIs are documented.
