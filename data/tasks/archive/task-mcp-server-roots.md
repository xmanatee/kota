---
status: done
---

# Add MCP roots capability to the KOTA MCP server

## Problem

`src/mcp/server.ts` declares `capabilities: { tools: {}, resources: {} }` but omits `roots`. The MCP protocol allows clients to send `roots/list` responses that tell the server which workspace directories are active. KOTA ignores this, so tool invocations cannot be scoped to the operator's project root — tools like file read/write use whatever working directory the daemon was started from, not the host's active workspace.

## Desired Outcome

- `src/mcp/server.ts` adds `roots: {}` to the declared server capabilities.
- A `roots/list` request handler retrieves the client-provided roots list.
- The resolved roots are stored on the session state and exposed to tool handlers that accept a path scope (e.g., via a new field on the tool execution context or via an MCP session registry).
- At minimum, the first root's `uri` is used as the working directory override for file-system tools when roots are provided.

## Constraints

- Follow the MCP 2024-11-05 protocol spec for roots.
- Do not break existing tool behavior when no roots are provided (graceful fallback).
- Roots should be per-connection, not global state.

## Done When

- Server advertises `roots` capability in `initialize` response.
- A roots list received from the client is accessible within tool handlers.
- Existing MCP server tests pass.
- A new test verifies roots are stored and accessible when provided.
