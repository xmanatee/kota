---
id: task-add-streamable-http-client-transport-for-mcp-servers
title: Add Streamable HTTP client transport for MCP servers
status: ready
priority: p2
area: core
summary: Let KOTA's MCP manager connect to remote Streamable HTTP MCP servers in addition to stdio subprocess servers, using a strict transport config union and current draft request metadata.
created_at: 2026-05-21T17:42:44Z
updated_at: 2026-05-21T17:42:44Z
---

## Problem

KOTA can expose its own MCP server over Streamable HTTP, and agent-harness
configuration can pass HTTP MCP server entries through to harnesses that own
their own client stack. KOTA's in-process MCP manager is still stdio-only:
`.kota/mcp.json` entries must name a subprocess command, and `McpClient`
describes itself as JSON-RPC over stdio.

That leaves a protocol gap for the session loop. Operators cannot point KOTA's
native MCP tool ingestion at a remote or already-running Streamable HTTP MCP
endpoint, even though the current MCP draft treats Streamable HTTP as a
standard transport beside stdio.

## Desired Outcome

KOTA's MCP manager accepts a strict transport-discriminated server
configuration for stdio and Streamable HTTP servers. HTTP MCP entries connect
to a configured endpoint URL, discover tools, keep the same namespaced tool
surface as stdio servers, and execute `tools/call` through the same runtime
tool path.

The stdio path remains the default for existing command-based entries. Invalid
or ambiguous MCP server config fails loudly at config load or connection time
instead of being coerced into a subprocess shape.

## Constraints

- Keep the client-side implementation in `src/core/mcp/`; do not import the
  module-owned MCP server adapter back into core.
- Preserve existing `.kota/mcp.json` stdio entries and existing stdio client
  behavior.
- Use one strict typed config protocol for MCP server entries. Do not add a
  parallel alias layer or silently infer HTTP from arbitrary fields.
- Send current draft Streamable HTTP requests with POST, `Accept:
  application/json, text/event-stream`, `MCP-Protocol-Version`, `Mcp-Method`,
  required `Mcp-Name` headers, and matching request-body `_meta`.
- Handle JSON and SSE response shapes deliberately. If any long-lived stream
  capability is not supported in the first slice, surface that as an explicit
  runtime limitation rather than a silent hang or dropped notification.
- Keep exact method names, header names, and wire shapes in source types and
  focused tests, not durable docs.

## Done When

- `.kota/mcp.json` supports both existing stdio server entries and explicit
  Streamable HTTP server entries with URL and optional headers.
- A test HTTP MCP server can be connected by `McpManager`, and its `tools/list`
  results appear as normal namespaced KOTA tools.
- `tools/call` against the HTTP server sends required draft request metadata
  headers and body `_meta`, then maps the result through the same output-schema
  validation and tool-result conversion used by stdio servers.
- Unsupported protocol versions, unknown methods, and transport-level HTTP
  failures surface as typed connection or tool errors that name the server.
- Existing stdio MCP client and manager behavior remains covered and green.

## Source / Intent

Explorer run `2026-05-21T17-41-07-655Z-explorer-8t3gkq` reviewed a queue with
zero actionable ready/doing tasks and read the never-seen MCP draft Transports
watchlist entry:

- `https://modelcontextprotocol.io/specification/draft/basic/transports`

The draft defines stdio and Streamable HTTP as the two standard MCP transports.
The Streamable HTTP section requires a single POST endpoint, localhost-safe
server posture, per-request metadata headers, protocol-version matching, JSON
or SSE responses, and header/body validation.

Local evidence:

- `src/core/mcp/AGENTS.md` says the MCP client and manager are session-loop
  runtime primitives that connect KOTA to external MCP servers.
- `src/core/mcp/manager.ts` currently defines MCP server config as
  `command`, optional `args`, and optional `env`, then constructs `McpClient`
  with subprocess parameters.
- `src/core/mcp/client.ts` describes `McpClient` as a lightweight JSON-RPC
  client over stdio and spawns a child process during `connect()`.
- `src/core/agent-harness/types.ts` already has an agent-harness-level
  `stdio | sse | http` MCP server union, but that pass-through surface does
  not let KOTA's own session-loop MCP manager ingest HTTP MCP tools.
- `data/tasks/blocked/task-add-streamable-http-transport-to-the-mcp-server.md`
  covers KOTA acting as an MCP server over HTTP. This task is the client-side
  counterpart and does not duplicate that server work.

The scaffold command was attempted first:

```sh
pnpm kota task create "Add Streamable HTTP client transport for MCP servers" --state ready --area core --priority p2 --summary "Let KOTA's MCP manager connect to remote Streamable HTTP MCP servers in addition to stdio subprocess servers, using a strict transport config union and current draft request metadata."
```

It failed before writing a file with `Fatal: fetch failed`, so this task was
normalized manually.

## Initiative

MCP protocol fidelity: KOTA should consume and expose MCP through the standard
transports current clients and servers use, without turning MCP into a second
capability registry.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A new test fixture or in-process HTTP server exercises `server/discover`,
  `tools/list`, and one `tools/call` over Streamable HTTP with draft request
  metadata headers.
- Existing stdio MCP manager tests still prove command-based `.kota/mcp.json`
  entries continue to work unchanged.
