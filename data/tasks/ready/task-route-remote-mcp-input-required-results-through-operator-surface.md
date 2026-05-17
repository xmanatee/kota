---
id: task-route-remote-mcp-input-required-results-through-operator-surface
title: Route remote MCP input_required results through an existing operator surface
status: ready
priority: p3
area: core
summary: Add safe runtime context so remote MCP input_required tool results can be answered through an existing operator or approval path instead of returning the explicit unsupported error.
created_at: 2026-05-17T02:28:21Z
updated_at: 2026-05-17T02:43:09.378Z
---

## Problem

`McpManager.executeTool()` now preserves draft remote MCP
`resultType: "input_required"` payloads and returns an explicit typed
unsupported error with diagnostics. That is the correct behavior for the
current runtime boundary because the manager only receives a tool name and
input object; it does not know which session, operator, approval surface, or
autonomy posture could safely answer the remote request.

KOTA still needs a routable path for remote MCP servers that legitimately use
draft multi-round input requests. Without that path, those tools fail honestly
but cannot complete.

## Desired Outcome

Remote MCP `input_required` results are routed through an existing KOTA
operator/approval surface when, and only when, the runtime has enough session
context to do that safely. The retry call sends explicit `inputResponses` and
the preserved `requestState`; runtimes without that context keep returning the
current typed unsupported error.

## Constraints

- Do not add a second owner-question, approval, or prompt surface just for
  MCP. Reuse an existing KOTA surface or keep the unsupported branch.
- Keep remote MCP payloads as untrusted external I/O. Validate once at the MCP
  boundary before routing.
- Do not fabricate `inputResponses`, silently retry, or drop `requestState`.
- Preserve the explicit unsupported error behavior for tool execution contexts
  that cannot safely reach an operator.

## Done When

- The MCP client can retry a remote `tools/call` with validated
  `inputResponses` and preserved `requestState`.
- The session/tool execution path carries only the context needed to route
  remote input through an existing operator surface.
- Tests cover accepted, rejected, and unavailable-operator outcomes without a
  new MCP-specific prompt surface.
- Existing unsupported diagnostics remain available when routing context is
  absent.

## Source / Intent

Follow-up from builder run `2026-05-17T02-18-50-134Z-builder-in7vsz` while
completing `task-handle-remote-mcp-input-required-tool-results`. That task
chose the explicit unsupported `is_error` branch because `McpManager` has no
safe operator-routing context today.

The draft MCP tools spec documents `input_required` results with
`inputRequests`, `requestState`, and retry-time `inputResponses`:
`https://modelcontextprotocol.io/specification/draft/server/tools`.

## Initiative

MCP protocol fidelity: KOTA should consume remote MCP tools through explicit,
typed runtime contracts rather than treating valid protocol branches as
malformed payloads.

## Acceptance Evidence

- Focused client and manager tests proving a remote `input_required` request
  can complete through the chosen existing operator surface.
- A negative test proving a context without safe operator routing still returns
  the typed unsupported error with preserved diagnostics.
