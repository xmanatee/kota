---
id: task-mcp-resource-subscriptions
title: Add MCP resource subscription push notifications to KOTA MCP server
status: backlog
priority: p3
area: runtime
summary: The KOTA MCP server exposes static resources but does not support resource subscriptions. MCP hosts that subscribe to resource changes would immediately see task queue or workflow status updates without re-polling.
created_at: 2026-03-31T12:22:00Z
updated_at: 2026-03-31T12:22:00Z
---

## Problem

`src/mcp/server.ts` advertises `resources: {}` in capabilities but does not implement `resources/subscribe` or `notifications/resources/updated`. MCP hosts (Claude Code, Cursor) that support the subscription protocol must resort to polling to detect when `kota://tasks/ready` or `kota://workflow/status` changes. This means a newly dispatched workflow or a fresh task in the queue may not appear in the host for up to the host's polling interval.

The daemon already has an internal event bus (`EventBus`) that fires `workflow.run.started`, `workflow.run.finished`, and task-state events — the data needed to drive subscription notifications is already available.

## Desired Outcome

- `src/mcp/server.ts` adds `resources: { subscribe: true }` to its `initialize` capabilities.
- A `resources/subscribe` handler registers the client's interest in a specific resource URI.
- A `resources/unsubscribe` handler removes it.
- When relevant bus events fire (workflow status change, task queue change), the server sends `notifications/resources/updated` for subscribed URIs over the open stdio transport.
- Existing `resources/list` and `resources/read` behavior is unchanged.

## Constraints

- Only `kota://workflow/status` and `kota://tasks/ready` need subscriptions in v1; `kota://workflow/runs/recent` can be added later.
- Subscription state is per-connection (in-memory); no persistence needed.
- Do not add new bus event types; subscribe only to existing events.
- Follow MCP 2024-11-05 protocol spec for `resources/subscribe`.

## Done When

- `initialize` response includes `resources: { subscribe: true }`.
- `resources/subscribe` and `resources/unsubscribe` handlers are implemented.
- Relevant bus events trigger `notifications/resources/updated` to subscribed clients.
- Existing MCP server tests pass.
- At least one test verifies that a subscribed client receives a notification when workflow status changes.
