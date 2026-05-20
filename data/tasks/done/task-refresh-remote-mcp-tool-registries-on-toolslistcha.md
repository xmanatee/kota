---
id: task-refresh-remote-mcp-tool-registries-on-toolslistcha
title: Refresh remote MCP tool registries on tools/list_changed notifications
status: done
priority: p2
area: core
summary: Subscribe to remote MCP tool-list change notifications and refresh KOTA's namespaced MCP tool registry so long-lived sessions do not keep stale or missing remote tools after a server's advertised tools change.
created_at: 2026-05-20T04:15:00Z
updated_at: 2026-05-20T04:25:59Z
---

## Problem

KOTA's MCP client lists remote tools once during `McpManager.initialize()` and
then treats the resulting `toolMap` / `kotaTools` arrays as fixed for the
lifetime of the session. `McpClient.handleLine()` explicitly ignores JSON-RPC
notifications without an `id`, so a remote MCP server cannot tell KOTA that its
tool list changed.

The current MCP draft Tools page defines the `tools.listChanged` capability and
`notifications/tools/list_changed` event for exactly this case. A server's tool
set may change over time, and clients that subscribe should refresh discovery
when notified. Without that lifecycle path, a long-lived KOTA session can keep
offering removed remote tools, miss newly available tools, or retain stale
schemas and annotations after the remote server changes its tool definitions.

## Desired Outcome

Remote MCP tool discovery becomes refreshable:

- `McpClient` decodes and records the remote server's `capabilities.tools.listChanged`
  flag from `initialize`.
- When a remote server supports tool-list change notifications, KOTA opens the
  required subscription and handles `notifications/tools/list_changed` instead
  of silently dropping it.
- `McpManager` refreshes one server's registry atomically by re-running the
  existing paginated `tools/list` path, rebuilding that server's namespaced
  tools, and preserving the previous registry if the refresh fails.
- Removed remote tools become unavailable after a successful refresh, newly
  advertised tools appear in `getTools()`, and existing validation still rejects
  malformed schemas, invalid `x-mcp-header` annotations, and invalid output
  schemas during the refresh.

## Constraints

- Keep the client side in `src/core/mcp/`; do not import MCP-server module
  helpers back into core.
- Reuse the existing `listTools()` decoder path for refreshes. Do not add a
  second tool-schema decoder for notifications.
- Do not poll by default. The protocol signal is event-driven; if a server does
  not advertise `listChanged`, KOTA may keep the current static behavior.
- Refresh failure must be visible as a warning or diagnostic while keeping the
  last known-good registry. A transient bad update should not erase all tools
  for that server.
- Preserve the current namespacing model (`mcp__<server>__<tool>`) and avoid a
  compatibility alias for removed tools.

## Done When

- A fake MCP server test proves KOTA records `tools.listChanged`, subscribes
  for tool-list changes, receives `notifications/tools/list_changed`, and calls
  `tools/list` again.
- A manager-level test proves a changed remote tool list updates `getTools()`
  and `isMcpTool()` / `executeTool()` routing without duplicating old entries.
- A failure test proves a malformed refreshed tool list leaves the prior
  registry intact and emits an actionable diagnostic.
- Existing MCP pagination, draft result variant, output-schema validation,
  `x-mcp-header`, and lifecycle tests remain green.

## Source / Intent

Explorer run `2026-05-20T04-13-01-976Z-explorer-hcuf5l` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured evidence and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Refresh remote MCP tool registries on tools/list_changed notifications" --state ready --area core --priority p2 --summary "Subscribe to remote MCP tool-list change notifications and refresh KOTA's namespaced MCP tool registry so long-lived sessions do not keep stale or missing remote tools after a server's advertised tools change."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the workflow sandbox. This file follows the normalized
task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools` is the
  official MCP draft Tools page. It documents `tools.listChanged`,
  `notifications/tools/list_changed`, and the subscription shape clients use to
  receive tool-list change notifications.

Local evidence:

- `src/core/mcp/client.ts` sends `initialize`, lists tools, and silently ignores
  server notifications without an `id`.
- `src/core/mcp/manager.ts` builds `toolMap` and `kotaTools` once during
  `initialize()` and has no server-specific refresh path.
- Existing completed MCP tasks cover pagination, rich result preservation,
  draft tool-result variants, output schema validation, and `x-mcp-header`
  validation, but not tool-list change notifications.

## Initiative

MCP protocol fidelity: KOTA should consume remote MCP tools through a strict
long-lived client boundary, not only through one-time startup discovery.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Test fixtures show a remote MCP server adding and removing a tool after
  initialization, KOTA refreshing only that server's namespaced registry, and a
  malformed refresh preserving the last known-good registry with a visible
  diagnostic.
- Completed in run `2026-05-20T04-18-02-490Z-builder-3cnbgh` with:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`,
  `pnpm lint`, and `pnpm typecheck`.
