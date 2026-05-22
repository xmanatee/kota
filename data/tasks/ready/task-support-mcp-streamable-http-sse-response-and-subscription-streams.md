---
id: task-support-mcp-streamable-http-sse-response-and-subscription-streams
title: Support MCP Streamable HTTP SSE response and subscription streams
status: ready
priority: p2
area: core
summary: Teach KOTA's HTTP MCP client and first-party Streamable HTTP server to consume and serve SSE response streams, including request-scoped notifications and subscriptions/listen catalog-change streams, instead of rejecting listChanged capabilities.
created_at: 2026-05-22T05:07:20Z
updated_at: 2026-05-22T05:07:20Z
---

## Problem

KOTA's Streamable HTTP MCP support is intentionally JSON-first today. The
external MCP client sends `Accept: application/json, text/event-stream`, but
only handles an SSE response when it contains exactly one final JSON-RPC
message. It rejects request-scoped progress over HTTP and fails connection
when an HTTP server advertises `tools.listChanged`, `resources.listChanged`,
or `prompts.listChanged` because it cannot hold a long-lived
`subscriptions/listen` stream.

The first-party `mcp-server` HTTP adapter mirrors that limitation from the
server side: it strips `listChanged` capability flags from `server/discover`
and `initialize`, rejects `subscriptions/listen`, and keeps resource
subscribe/unsubscribe unavailable over HTTP. That was a valid first slice,
but the current MCP draft now describes Streamable HTTP SSE as the standard
path for both request-scoped notifications and long-lived catalog/update
streams.

Without this slice, KOTA can connect only to the simpler subset of HTTP MCP
servers and cannot expose its own live resource/prompt catalog updates over
the standard HTTP transport.

## Desired Outcome

KOTA supports Streamable HTTP SSE streams as a first-class MCP transport mode:

- HTTP client requests can read `text/event-stream` responses containing zero
  or more in-flight JSON-RPC notifications followed by the final response.
- Request-scoped `notifications/progress` and `notifications/message` events
  are dispatched through the same typed progress/logging paths used by stdio.
- HTTP servers that advertise list-change capabilities no longer cause client
  connection failure; the client opens a long-lived `subscriptions/listen`
  POST whose SSE body dispatches `notifications/tools/list_changed`,
  `notifications/resources/list_changed`, and
  `notifications/prompts/list_changed`.
- The first-party Streamable HTTP server can advertise and serve
  `subscriptions/listen` over SSE for the resource and prompt notifications it
  already supports over stdio.

## Constraints

- Keep the external MCP client boundary in `src/core/mcp/`; do not import
  server-module helpers into core.
- Keep first-party HTTP transport logic in `src/modules/mcp-server/streamable-http.ts`
  and reuse the existing `McpServer` dispatch/feature handlers. Do not fork
  resource or prompt semantics for HTTP.
- Preserve JSON-only request behavior for clients and servers that do not need
  streaming.
- Treat SSE disconnect as request cancellation for the request that owns the
  stream, matching the draft transport rule. Avoid orphaned progress or
  subscription state after client close, timeout, or `close()`.
- Do not reintroduce the old HTTP+SSE GET transport. The current draft uses
  POST-only Streamable HTTP; long-lived notification streams come from a
  `subscriptions/listen` request response.
- Keep exact event framing, subscription metadata, and error behavior in source
  types and focused tests, not durable docs.

## Done When

- `McpClient` can consume an HTTP SSE response that emits progress/message
  notifications before the final response, and malformed/missing-final streams
  fail loudly with useful errors.
- `McpClient` opens and manages an HTTP `subscriptions/listen` SSE stream when
  a remote HTTP server advertises tools/resource/prompt `listChanged`, dispatches
  the notifications to existing handlers, and closes the stream on client close.
- The manager refresh path still handles `notifications/tools/list_changed`
  from HTTP MCP servers and preserves last-known-good tools if refresh fails.
- `mcp-server` Streamable HTTP no longer strips implemented `listChanged`
  capabilities, accepts `subscriptions/listen` with the existing draft
  notification flags, and emits SSE events with subscription metadata for
  resource and prompt list changes.
- Unsupported HTTP streaming cases remain explicit errors instead of silent
  capability advertisement.
- Existing stdio MCP behavior remains green.

## Source / Intent

Explorer run `2026-05-22T05-04-46-015Z-explorer-29a2k7` reviewed a queue with
zero actionable ready/doing tasks. The strategic blocked alternatives all still
require operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Support MCP Streamable HTTP SSE response and subscription streams" --state ready --area core --priority p2 --summary "Teach KOTA's HTTP MCP client and first-party Streamable HTTP server to consume and serve SSE response streams, including request-scoped notifications and subscriptions/listen catalog-change streams, instead of rejecting listChanged capabilities."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/basic/transports`
  says Streamable HTTP clients must send `Accept` for both JSON and SSE and
  must support either JSON or `text/event-stream` responses. It also defines
  `subscriptions/listen` as a long-lived SSE response stream for list-change
  and resource-update notifications, and says closing the SSE response stream
  cancels that request.

Local evidence:

- `src/core/mcp/client.ts` sends `Accept: application/json, text/event-stream`
  but rejects HTTP progress, parses only a single SSE JSON-RPC message, and
  rejects HTTP servers that advertise list-change streams.
- `src/core/mcp/client.test.ts` currently asserts those HTTP list-change
  advertisements are rejected.
- `src/modules/mcp-server/streamable-http.ts` rejects `subscriptions/listen`
  and strips `listChanged` flags from HTTP discovery responses.
- `src/modules/mcp-server/streamable-http.test.ts` currently locks in the
  "SSE-dependent behavior unavailable" first-slice behavior.

## Initiative

MCP protocol fidelity: KOTA should speak the current Streamable HTTP transport
strictly enough to interoperate with live remote MCP servers while keeping the
core client and first-party server module boundaries clean.

## Acceptance Evidence

- Focused core MCP tests pass, including new Streamable HTTP SSE response and
  subscription fixtures, for example `pnpm test src/core/mcp/client.test.ts
  src/core/mcp/manager.test.ts`.
- Focused first-party MCP server tests pass, including HTTP
  `subscriptions/listen` and SSE-disconnect cancellation cases, for example
  `pnpm test src/modules/mcp-server/streamable-http.test.ts
  src/modules/mcp-server/server.test.ts`.
- A regression fixture proves a remote HTTP MCP server advertising
  `tools.listChanged` no longer fails connection and still refreshes the
  manager's registry when the SSE notification arrives.
