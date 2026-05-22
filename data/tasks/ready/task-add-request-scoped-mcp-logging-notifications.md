---
id: task-add-request-scoped-mcp-logging-notifications
title: Add request-scoped MCP logging notifications
status: ready
priority: p2
area: modules
summary: Align KOTA's MCP server with the draft logging utility by accepting request-scoped logLevel metadata, emitting sanitized notifications/message entries on the same response stream, and documenting the deprecated capability boundary without relying on stderr for Streamable HTTP diagnostics.
created_at: 2026-05-22T01:02:09Z
updated_at: 2026-05-22T01:02:09Z
---

## Problem

KOTA's first-party MCP server has converged on most of the current draft
surface: per-request draft metadata, Streamable HTTP, progress notifications,
tasks, MRTR, resources, prompts, tools, completion, roots, cancellation, and
authorization. It still treats server diagnostics as an out-of-band local log:
handlers call `ctx.log(...)`, the stdio path writes those messages to stderr,
and the Streamable HTTP path has no protocol-visible diagnostic stream.

The current MCP draft logging utility is deprecated as of `DRAFT-2026-v1`, but
still defines a supported transition contract: when a request includes
`io.modelcontextprotocol/logLevel` in `_meta`, the server may emit
`notifications/message` on that request's response stream before the final
response, and it must not emit those notifications for requests that did not
ask for them. The MCP debugging guide also calls out that stderr is not
captured by Streamable HTTP clients, so protocol log notifications are the
transport-neutral diagnostic surface.

Without this slice, HTTP MCP clients can exercise KOTA's tools but cannot ask
for scoped server diagnostics through the protocol. Operators have to fall back
to process stderr, server-side logs, or ad hoc HTTP tooling even for request-
local initialization, resource, tool-call, and error context.

## Desired Outcome

KOTA supports request-scoped MCP logging in the first-party MCP server without
turning logging into a second telemetry system. A draft request that includes
`io.modelcontextprotocol/logLevel` receives sanitized `notifications/message`
entries at or above the requested severity on the same response stream before
the final response. A request without that field receives no log-message
notifications. Invalid log levels fail loudly as invalid params.

The implementation keeps the deprecated status explicit: support the current
draft's per-request `_meta` contract, avoid adding a new stateful
`logging/setLevel` control path unless a deliberately legacy compatibility
branch is required, and keep KOTA's durable observability in the existing
tracing/run-artifact/logging surfaces.

## Constraints

- Keep the work inside `src/modules/mcp-server/` unless a shared MCP protocol
  type genuinely has to move.
- Reuse the existing MCP transport and handler context; do not add a parallel
  diagnostic bus or a second logger abstraction for MCP.
- Treat log payloads as external protocol output: sanitize secrets, keep data
  JSON-serializable, and avoid leaking internal paths or stack traces unless
  the existing user-facing error surface already exposes them.
- Do not emit `notifications/message` for requests that omit
  `io.modelcontextprotocol/logLevel`.
- The Streamable HTTP adapter must not turn a request with log notifications
  into a generic "SSE response streams are not implemented" error. If the
  response needs SSE, negotiate it explicitly through `Accept` and keep JSON-
  only clients on a clear unsupported-response error.
- Keep exact method names, log-level validation, and response shapes in source
  types and focused tests, not durable docs.

## Done When

- Draft request metadata parsing recognizes optional
  `io.modelcontextprotocol/logLevel`, validates the RFC 5424 level set, and
  stores the requested threshold in the per-request context.
- The MCP server can emit `notifications/message` payloads with
  `{ level, logger?, data }` from existing request handlers, filtered by the
  requested threshold.
- Requests without `io.modelcontextprotocol/logLevel` produce no log-message
  notifications, even when handlers call the internal log helper.
- Streamable HTTP requests that accept SSE can receive request-scoped
  `notifications/message` entries before the final JSON-RPC response on the
  same response stream. JSON-only HTTP requests fail with a clear protocol
  error if the requested logging would require streaming.
- Stdio behavior remains valid: local stderr logging stays available for host
  capture, and protocol log notifications are emitted only for request-scoped
  requests that ask for them.
- Tests cover invalid log level, severity filtering, no-log-by-default,
  same-request response ordering, HTTP SSE negotiation, and sanitized payloads.

## Source / Intent

Explorer run `2026-05-22T00-59-49-325Z-explorer-pmjedd` reviewed an empty
actionable queue. All strategic blocked alternatives exposed by `inspect-queue`
were real operator-capture waits and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add request-scoped MCP logging notifications" --state ready --area modules --priority p2 --summary "Align KOTA's MCP server with the draft logging utility by accepting request-scoped logLevel metadata, emitting sanitized notifications/message entries on the same response stream, and documenting the deprecated capability boundary without relying on stderr for Streamable HTTP diagnostics."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/server/utilities/logging`
  defines the deprecated-but-supported draft logging utility, the
  `io.modelcontextprotocol/logLevel` request metadata field, request-scoped
  `notifications/message`, invalid-level handling, and the requirement to avoid
  emitting log notifications when the request did not ask for them.
- `https://modelcontextprotocol.io/specification/draft/basic/index` lists
  `io.modelcontextprotocol/logLevel` as optional per-request metadata in the
  draft base protocol.
- `https://modelcontextprotocol.io/docs/tools/debugging` says stderr is
  captured for stdio servers but not by Streamable HTTP clients, and points to
  log message notifications for transport-neutral server diagnostics.

Local evidence:

- `src/modules/mcp-server/server.ts` decodes required draft metadata and tracks
  progress tokens, but does not decode `io.modelcontextprotocol/logLevel`.
- `src/modules/mcp-server/server.ts` and feature handlers call `ctx.log(...)`
  for initialization, tool-call, progress-validation, and subscription
  diagnostics; those messages currently go only to the configured local log
  sink.
- `src/modules/mcp-server/streamable-http.ts` currently rejects multi-message
  dispatch results with `SSE response streams are not implemented for
  Streamable HTTP`, so request-scoped log notifications need an explicit HTTP
  response-stream path.
- Repository search found no existing open MCP logging task or implementation
  of `notifications/message` / `io.modelcontextprotocol/logLevel`.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should expose diagnostics
through the protocol shape current clients can consume, while keeping durable
observability in the existing tracing and run-artifact systems.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/streamable-http.test.ts`.
- A transcript or fixture under `.kota/runs/<run-id>/` shows a draft HTTP MCP
  request with `io.modelcontextprotocol/logLevel` receiving at least one
  `notifications/message` before its final response, and the same request
  without `logLevel` receiving only the final response.
