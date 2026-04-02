---
id: task-mcp-elicitation-support
title: Add MCP elicitation support so KOTA tools can request structured user input
status: ready
priority: p3
area: mcp
summary: The MCP spec (2025-03-26) added an elicitation capability that lets servers request structured input from the connected client (user). KOTA's MCP server does not implement this, so tools that need a follow-up question or confirmation from the operator cannot leverage the standard protocol path.
created_at: 2026-04-02T03:58:38Z
updated_at: 2026-04-02T10:41:13Z
---

## Problem

MCP's elicitation capability (introduced in the 2025-03-26 protocol revision)
allows a server to send a `sampling/elicit` request to the client during a tool
call, prompting the user for structured input (text, boolean, enum choice) and
receiving the response before completing the tool result.

KOTA's MCP server (`src/mcp/server.ts`) does not advertise `elicitation: {}`
in its capabilities and has no handler for `sampling/elicit` client responses.
Tools that would benefit from operator confirmation or follow-up input must
either return an ambiguous partial result or treat the absence of confirmation
as implicit approval.

Reference: https://modelcontextprotocol.io/specification/2025-03-26/client/elicitation

## Desired Outcome

- `McpServer.handleInitialize` advertises `elicitation: {}` in the server
  capabilities block when the connected client supports it (detected from the
  client's `initialize` capabilities).
- A `requestElicitation(schema, message)` helper on `McpServer` sends the
  `sampling/elicit` JSON-RPC request to the client and awaits the response.
- At least one built-in tool (e.g., a task-state-change or approval action)
  uses elicitation to confirm a consequential action before executing.
- The server gracefully falls back (no elicitation, proceeds with defaults) when
  the client does not advertise elicitation capability.

## Constraints

- Elicitation is only sent to clients that advertise `elicitation: {}` in their
  `initialize` capabilities — do not send to clients that don't support it.
- Elicitation requests block the tool call; keep timeout handling explicit (fail
  with a clear error if the client does not respond within a reasonable window).
- No new npm dependencies — the MCP server is implemented with plain Node.js
  JSON-RPC and must stay that way.
- Follow the 2025-03-26 spec schema for `sampling/elicit` request and response
  shapes.
- Update `docs/MCP.md` to document the new capability.

## Done When

- `McpServer` advertises `elicitation` capability to clients that support it.
- At least one tool demonstrates elicitation with a simple schema (e.g., a
  yes/no confirmation).
- Elicitation-capable and non-capable clients both work without errors.
- `docs/MCP.md` documents the elicitation capability and usage pattern.
- Existing MCP server tests pass unchanged.
