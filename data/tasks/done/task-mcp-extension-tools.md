---
id: task-mcp-module-tools
title: Expose module-contributed tools through the KOTA MCP server
status: done
priority: p3
area: mcp
summary: The MCP server currently exposes only built-in KOTA tools via getAllTools(). Modules that contribute custom tools (e.g., the GitHub module's PR and issue tools) are invisible to MCP clients. Module tools should be registered dynamically so any MCP host can invoke them.
created_at: 2026-04-02T09:32:00Z
updated_at: 2026-04-02T12:15:00Z
---

## Problem

`McpServer` calls `getAllTools()` from `tools/index.ts`, which returns only the
static built-in tool set. Modules that register custom tools via the module
lifecycle (e.g., GitHub PR tools, foreign module tools, or operator-written
module tools) are never exposed over MCP.

A Claude Code user who connects to the KOTA MCP server and has the GitHub module
loaded cannot call `github_create_pr` or `github_list_issues` through MCP — they
must use a separate integration or direct CLI invocation. This defeats the purpose
of tool-contributing modules when the primary interaction surface is MCP.

## Desired Outcome

`McpServer` can be initialized with an optional module tool registry so that
tools contributed by loaded modules are included in the `tools/list` response
and routable via `tools/call`.

When running as the embedded daemon MCP server (started via the daemon's MCP
endpoint), the server automatically includes all module-contributed tools from
the loaded module set. When run standalone (via `kota mcp serve`), only built-in
tools are available unless module config is provided.

## Constraints

- Module tools must go through the same `toolFilter` and guardrail path as
  built-in tools.
- No change to the MCP protocol surface — this is purely a tool registration
  expansion inside the existing `tools/list` and `tools/call` handlers.
- Modules that fail to load do not block MCP server startup.
- The `McpServerOptions` type gains an optional `moduleTools` field; the
  standalone `kota mcp serve` command does not require it.

## Done When

- Module-contributed tools appear in the `tools/list` MCP response when the
  server is initialized with them.
- `tools/call` can invoke an module-contributed tool and return its result.
- The GitHub module's tools are accessible via MCP when the module is loaded.
- Existing unit tests for MCP tool listing continue to pass.
