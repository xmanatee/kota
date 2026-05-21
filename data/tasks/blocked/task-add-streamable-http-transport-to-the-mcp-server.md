---
id: task-add-streamable-http-transport-to-the-mcp-server
title: Add Streamable HTTP transport to the MCP server
status: blocked
priority: p2
area: modules
summary: Expose KOTA's first-party MCP server over the current Streamable HTTP transport with strict draft header validation, localhost-safe defaults, and transcript evidence while preserving the existing stdio path.
created_at: 2026-05-21T13:26:26.757Z
updated_at: 2026-05-21T17:42:44Z
---

## Problem

KOTA's first-party MCP server is currently a stdio-only operator surface. That
works for local subprocess hosts, but the current MCP draft now treats
Streamable HTTP as a standard transport beside stdio. HTTP-hosted MCP clients
and intermediaries expect a single MCP endpoint, per-request protocol metadata
headers, strict header/body validation, safe local binding behavior, and
request-scoped cancellation semantics.

The server already has most of the protocol method surface under
`src/modules/mcp-server/`, including draft discovery, tools, resources,
prompts, completion, progress, MRTR, elicitation, and tasks. Without a
Streamable HTTP transport, that surface remains inaccessible to MCP clients
that cannot launch KOTA as their own stdio child process.

## Desired Outcome

KOTA can expose the existing `mcp-server` module through a Streamable HTTP
endpoint without duplicating the MCP feature handlers or tool/resource/prompt
registries. The existing `kota mcp-server` stdio path remains intact, while a
clear module-owned operator path starts an HTTP MCP endpoint and reports the
URL it is serving.

The HTTP transport follows the current draft boundary for ordinary MCP
requests: POST-only JSON-RPC messages, required request metadata headers,
`Accept` handling for JSON/SSE-capable clients, strict protocol-version and
header/body matching, and spec-shaped errors for malformed or mismatched
headers. Any long-lived or streaming feature that is not implemented in the
first slice must be explicitly unavailable over HTTP rather than silently
advertised.

## Constraints

- Keep the implementation in `src/modules/mcp-server/` unless a shared MCP
  protocol type genuinely has to move. Do not add a parallel MCP registry.
- Reuse the existing per-feature handlers behind a transport adapter; do not
  fork method semantics between stdio and HTTP.
- Bind to localhost by default and validate `Origin` before accepting requests.
  Non-local binding must require an explicit operator choice and an
  authentication story, not an accidental open port.
- Validate `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and recognized
  `Mcp-Param-*` headers against the JSON-RPC body before dispatch.
- Return `400` with JSON-RPC `-32001` for header mismatches, `400` with
  supported-version data for unsupported protocol versions, and `404` with
  `-32601` for unknown methods.
- Preserve the stdio shutdown and built-CLI smoke behavior. Existing stdio
  clients must not see changed capabilities or response shapes from this work.
- Keep exact wire shapes in source types and focused tests, not durable docs.

## Done When

- A module-owned CLI or client path starts the MCP server in Streamable HTTP
  mode and prints the local endpoint.
- `server/discover`, `tools/list`, and one state-changing `tools/call` can be
  exercised over HTTP with valid draft per-request metadata and required
  headers.
- Missing, malformed, or mismatched `MCP-Protocol-Version`, `Mcp-Method`, and
  `Mcp-Name` headers are rejected before handler dispatch with the draft
  HTTP/JSON-RPC error shape.
- Invalid `Origin` is rejected with HTTP 403; local allowed-origin behavior is
  covered by tests.
- `subscriptions/listen`, progress streaming, or other SSE-dependent behavior
  is either implemented with SSE or explicitly not advertised/accepted over
  HTTP until a later slice owns it.
- Existing stdio MCP server tests and the built CLI stdio smoke remain green.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-05-21T16-38-28-976Z-builder-3qw64n/operator-http-transcript.txt
description: live endpoint transcript captured on a host that allows local listen(); run `kota mcp-server --http --host 127.0.0.1 --port 0`, record the printed endpoint URL, call `server/discover`, `tools/list`, and one state-changing `tools/call` through that endpoint with valid Streamable HTTP draft headers, then record at least one mismatched-header rejection. The existing `http-transcript.txt` in this run records the sandbox `listen EPERM` blocker plus adapter-only checks, so it intentionally does not satisfy this precondition.
```

## Source / Intent

Explorer run `2026-05-21T13-21-54-749Z-explorer-v1tezq` reviewed a thin queue
with zero actionable ready/doing tasks. The strategic blocked alternatives all
still require operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add Streamable HTTP transport to the MCP server" --state ready --area modules --priority p2 --summary "Expose KOTA's first-party MCP server over the current Streamable HTTP transport with strict draft header validation, localhost-safe defaults, and transcript evidence while preserving the existing stdio path."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/basic/transports`
  documents stdio and Streamable HTTP as the standard MCP transports. The
  Streamable HTTP section requires a single POST endpoint, origin validation,
  localhost-safe defaults, `Accept` support for JSON/SSE, request metadata
  headers, protocol-version/header matching, and `HeaderMismatch` errors.

Local evidence:

- `src/modules/mcp-server/AGENTS.md` says the module exposes KOTA tools through
  MCP over stdio.
- `src/modules/mcp-server/index.ts` registers a single `mcp-server` command
  that starts the local stdio server.
- `src/modules/mcp-server/mcp-server-operations.ts` describes `kota mcp-server`
  as a JSON-RPC stdio MCP server.
- `src/modules/mcp-server/server.ts` owns JSON-RPC dispatch and already has
  draft protocol metadata handling, but it is wired to input/output streams
  rather than an HTTP request adapter.
- Repository search found no existing open Streamable HTTP MCP task or inbox
  item.

## Initiative

MCP protocol fidelity: KOTA should expose its module-owned MCP capability
surface through the standard transports current clients can use, without
turning MCP into a second capability registry.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-server-operations.test.ts`.
- Built CLI stdio smoke remains green, for example
  `pnpm test src/built-cli-mcp-server.integration.test.ts`.
- A transcript under `.kota/runs/<run-id>/` shows starting the HTTP endpoint,
  calling `server/discover`, `tools/list`, and one `tools/call` with valid
  headers, then at least one rejected mismatched-header request.

Implementation progress in run `2026-05-21T16-38-28-976Z-builder-3qw64n`:

- `pnpm exec biome check src/modules/mcp-server`
- `pnpm typecheck`
- `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-server-operations.test.ts src/modules/mcp-server/streamable-http.test.ts src/modules/mcp-server/index.test.ts`
- `pnpm build`
- `pnpm test src/built-cli-mcp-server.integration.test.ts`
- `.kota/runs/2026-05-21T16-38-28-976Z-builder-3qw64n/http-transcript.txt`
  records the sandbox `listen EPERM` blocker and adapter-level request
  exercise. It does not satisfy the unblock precondition; the
  operator-captured live endpoint transcript must be written to
  `.kota/runs/2026-05-21T16-38-28-976Z-builder-3qw64n/operator-http-transcript.txt`
  before this task can return to `done/`.
