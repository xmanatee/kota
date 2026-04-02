---
id: task-mcp-extension-tools
title: Expose extension-contributed tools through the KOTA MCP server
status: done
priority: p3
area: mcp
summary: The MCP server currently exposes only built-in KOTA tools via getAllTools(). Extensions that contribute custom tools (e.g., the GitHub extension's PR and issue tools) are invisible to MCP clients. Extension tools should be registered dynamically so any MCP host can invoke them.
created_at: 2026-04-02T09:32:00Z
updated_at: 2026-04-02T12:15:00Z
---

## Problem

`McpServer` calls `getAllTools()` from `tools/index.ts`, which returns only the
static built-in tool set. Extensions that register custom tools via the extension
lifecycle (e.g., GitHub PR tools, foreign extension tools, or operator-written
extension tools) are never exposed over MCP.

A Claude Code user who connects to the KOTA MCP server and has the GitHub extension
loaded cannot call `github_create_pr` or `github_list_issues` through MCP — they
must use a separate integration or direct CLI invocation. This defeats the purpose
of tool-contributing extensions when the primary interaction surface is MCP.

## Desired Outcome

`McpServer` can be initialized with an optional extension tool registry so that
tools contributed by loaded extensions are included in the `tools/list` response
and routable via `tools/call`.

When running as the embedded daemon MCP server (started via the daemon's MCP
endpoint), the server automatically includes all extension-contributed tools from
the loaded extension set. When run standalone (via `kota mcp serve`), only built-in
tools are available unless extension config is provided.

## Constraints

- Extension tools must go through the same `toolFilter` and guardrail path as
  built-in tools.
- No change to the MCP protocol surface — this is purely a tool registration
  expansion inside the existing `tools/list` and `tools/call` handlers.
- Extensions that fail to load do not block MCP server startup.
- The `McpServerOptions` type gains an optional `extensionTools` field; the
  standalone `kota mcp serve` command does not require it.

## Done When

- Extension-contributed tools appear in the `tools/list` MCP response when the
  server is initialized with them.
- `tools/call` can invoke an extension-contributed tool and return its result.
- The GitHub extension's tools are accessible via MCP when the extension is loaded.
- Existing unit tests for MCP tool listing continue to pass.
