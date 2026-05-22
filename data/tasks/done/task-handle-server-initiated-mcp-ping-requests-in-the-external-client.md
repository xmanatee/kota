---
id: task-handle-server-initiated-mcp-ping-requests-in-the-external-client
title: Handle server-initiated MCP ping requests in the external client
status: done
priority: p2
area: core
summary: Teach KOTA's external MCP client to treat server-initiated ping as a real JSON-RPC request, preserve string-or-number request ids at the protocol boundary, and respond promptly across stdio and supported Streamable HTTP/SSE paths.
created_at: 2026-05-22T12:05:34Z
updated_at: 2026-05-22T16:54:47Z
---

## Problem

KOTA's first-party MCP server already responds to `ping`, but KOTA as an
external MCP client does not. `src/core/mcp/client-notifications.ts` only
matches pending or streaming responses when `msg.id` is a number, then routes
any remaining message with a `method` string through notification handling.
An external MCP server that sends a server-initiated `ping` request therefore
receives no JSON-RPC response, even though the draft allows either peer to
initiate `ping` at any time on an established connection.

The same boundary is too narrow for draft JSON-RPC IDs. The official MCP base
protocol allows request and response IDs to be strings or integers, while the
external client types model IDs as numbers. KOTA can continue generating
numeric request IDs for its own calls, but inbound peer requests such as
`ping` must preserve and echo the exact string-or-number ID they arrived with.

Without this, remote stdio MCP servers can mark KOTA stale during normal
liveness checks, and the Streamable HTTP/SSE parsing path has no explicit
behavior for protocol-level ping messages that arrive on a stream.

## Desired Outcome

KOTA's external MCP client handles MCP liveness checks as a protocol feature
instead of ignoring them:

- Inbound JSON-RPC `ping` requests with string or numeric IDs receive a prompt
  `{}` result response with the same ID.
- Unknown inbound server-to-client requests still fail loudly or produce a
  clear unsupported-method diagnostic rather than being mistaken for
  notifications.
- The client keeps numeric IDs for KOTA-originated requests if that remains
  simplest, while protocol decode types and inbound request handling accept
  string or numeric peer request IDs.
- Streamable HTTP/SSE behavior is explicit: either supported server-to-client
  `ping` requests receive a valid response through the current transport
  mechanism, or unsupported response paths are rejected with a clear error
  instead of silently dropping the request.

## Constraints

- Keep the external MCP client implementation in `src/core/mcp/`; do not import
  first-party server-module helpers into core.
- Preserve existing pending-request, progress, log notification, and
  `subscriptions/listen` behavior.
- Do not add a background polling health checker unless it is needed for the
  protocol response path. The minimum required fix is to answer peer-initiated
  `ping` correctly.
- Do not widen JSON-RPC IDs to arbitrary values. Accept only non-null strings
  and integers at the boundary.
- Keep exact wire shapes and unsupported-path behavior in source types and
  focused tests, not durable docs.

## Done When

- A stdio MCP client fixture sends `{"jsonrpc":"2.0","id":"server-ping-1","method":"ping"}`
  after initialization and observes `{"jsonrpc":"2.0","id":"server-ping-1","result":{}}`
  from KOTA.
- A numeric-ID server-initiated `ping` also receives a matching empty result,
  and existing KOTA-originated request/response handling remains unchanged.
- The Streamable HTTP/SSE path has focused coverage proving server-to-client
  `ping` behavior is either supported with a valid JSON-RPC response or fails
  with an explicit protocol error that names why the transport cannot respond.
- Unknown inbound server-to-client requests do not disappear silently.
- Existing MCP client, manager, and first-party MCP server tests remain green.

## Source / Intent

Explorer run `2026-05-22T12-02-32-215Z-explorer-9rrw9h` reviewed a queue with
zero actionable ready/doing tasks. The strategic blocked alternatives all
still require operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Handle server-initiated MCP ping requests in the external client" --state ready --area core --priority p2 --summary "Teach KOTA's external MCP client to treat server-initiated ping as a real JSON-RPC request, preserve string-or-number request ids at the protocol boundary, and respond promptly across stdio and supported Streamable HTTP/SSE paths."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/basic/utilities/ping`
  says either client or server can initiate a `ping` request at any time on an
  established connection, and the receiver must respond promptly with an empty
  result.
- `https://modelcontextprotocol.io/specification/draft/basic` defines MCP
  requests and responses with string-or-number request IDs, requires IDs to be
  non-null, and requires responses to include the same ID as the request.

Local evidence:

- `src/modules/mcp-server/server.ts` registers a first-party `ping` handler,
  and `src/modules/mcp-server/server.test.ts` proves the server responds.
- `src/core/mcp/client-protocol.ts` models `JsonRpcRequest.id` and
  `JsonRpcResponse.id` as `number`.
- `src/core/mcp/client-notifications.ts` handles only numeric IDs as pending
  or streaming responses, then treats remaining method-bearing messages as
  notifications. There is no client-side response path for inbound `ping`.
- `src/core/mcp/client-http-runtime.ts` parses SSE messages with a method as
  notifications and has no explicit server-to-client request handling path.

## Initiative

MCP protocol fidelity: KOTA should behave as a correct MCP peer when consuming
remote servers, not only when exposing its own first-party MCP server.

## Acceptance Evidence

- Focused MCP client tests pass, for example
  `pnpm test src/core/mcp/client.test.ts`.
- Focused MCP manager tests pass, for example
  `pnpm test src/core/mcp/manager.test.ts`.
- First-party MCP server tests remain green, for example
  `pnpm test src/modules/mcp-server/server.test.ts`.
