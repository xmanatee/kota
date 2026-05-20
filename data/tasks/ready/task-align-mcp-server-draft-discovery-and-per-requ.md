---
id: task-align-mcp-server-draft-discovery-and-per-requ
title: Align the MCP server with draft discovery and per-request metadata
status: ready
priority: p2
area: modules
summary: Add the draft server/discover and per-request _meta protocol boundary to KOTA's first-party MCP server so DRAFT-2026-v1 clients do not depend on the legacy initialize session state.
created_at: 2026-05-20T05:26:19Z
updated_at: 2026-05-20T05:26:19Z
---

## Problem

KOTA's MCP server has started adopting current draft feature details for tools
and resources, but its protocol boundary is still the older connection-state
shape. `McpServer` has no `server/discover` handler, every feature handler
requires an `initialize` request to set mutable `SessionState`, and draft
client capabilities / protocol version are inferred from that connection state
instead of decoded from each request's `_meta`.

That makes `DRAFT-2026-v1` support nominal. A draft stdio client that probes
`server/discover` gets `Method not found`, and a client that sends a draft
request with `_meta.io.modelcontextprotocol/protocolVersion` but without the
legacy initialize handshake gets `Server not initialized`. The same drift also
lets client-feature concepts leak into server capabilities: sampling is
advertised from `initialize` when enabled even though the current draft models
sampling and elicitation as client-side requests that servers ask for through
the multi round-trip request pattern.

## Desired Outcome

KOTA has one explicit MCP protocol boundary:

- `server/discover` works before any legacy initialization and reports the
  server's supported versions, server capabilities, and server identity.
- Draft requests decode `_meta.io.modelcontextprotocol/protocolVersion`,
  `_meta.io.modelcontextprotocol/clientInfo`, and
  `_meta.io.modelcontextprotocol/clientCapabilities` per request instead of
  relying on connection-level session state.
- Existing legacy `initialize` behavior stays as a deliberate compatibility
  path for `2024-11-05` clients.
- Feature handlers receive request-scoped protocol/client capability facts for
  draft calls; malformed or unsupported metadata fails loudly with an MCP
  protocol error that names supported versions.
- Draft capabilities do not advertise client features such as sampling or
  elicitation as server capabilities. If KOTA keeps its legacy
  `sampling/createMessage` server endpoint, it is hidden behind the legacy
  compatibility path or exposed as a clearly named extension rather than as a
  draft server capability.

## Constraints

- Keep the work inside `src/modules/mcp-server/` unless a shared protocol type
  genuinely has to move. Do not pull the server module into `src/core/mcp/`.
- Do not rewrite the remote MCP client/manager in this task; this is the
  first-party server boundary.
- Preserve old clients that still perform `initialize` + `notifications/initialized`.
  Removing legacy support would be a separate compatibility decision.
- Do not add a prose catalog of every MCP method or payload shape to docs.
  Exact wire contracts belong in protocol types and focused tests.
- Do not silently coerce missing draft `_meta` into legacy defaults. Draft and
  legacy protocol paths should be explicit at the boundary.

## Done When

- `server/discover` before `initialize` returns a complete result with
  supported versions, server capabilities, and server info.
- A draft request such as `tools/list`, `prompts/list`, or `resources/list`
  succeeds without a prior `initialize` when it carries valid per-request
  `_meta`.
- The same draft request without required `_meta`, with an unsupported
  protocol version, or with malformed client capabilities fails loudly and
  includes supported-version information where applicable.
- Legacy initialization tests still pass for `2024-11-05` clients.
- Draft initialization/discovery capability tests prove KOTA does not advertise
  `sampling` or `elicitation` as server capabilities.
- Existing MCP server tests for tools, resources, prompts, completion,
  elicitation, sampling legacy behavior, and roots compatibility remain green.

## Source / Intent

Explorer run `2026-05-20T05-23-08-333Z-explorer-zsl6h3` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align the MCP server with draft discovery and per-request metadata" --state ready --area modules --priority p2 --summary "Add the draft server/discover and per-request _meta protocol boundary to KOTA's MCP server so draft clients do not depend on the legacy initialize session state."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/server/discover`
  documents `server/discover` and says servers must implement it.
- `https://modelcontextprotocol.io/specification/draft/basic/index`
  documents required per-request `_meta` protocol fields for draft requests.
- `https://modelcontextprotocol.io/specification/draft/basic/utilities/mrtr`
  documents `InputRequiredResult` as the path for server-to-client requests
  such as `elicitation/create`, `sampling/createMessage`, and `roots/list`.
- `https://modelcontextprotocol.io/specification/draft/client/sampling`
  documents sampling as a client feature, with request association and
  deprecation notes for `DRAFT-2026-v1`.

Local evidence:

- `src/modules/mcp-server/server.ts` registers `initialize`, tools, resources,
  prompts, sampling, completion, and ping handlers, but not `server/discover`.
- `src/modules/mcp-server/mcp-handlers-initialize.ts` stores protocol version,
  roots, and client feature support in mutable session state and advertises
  sampling from server capabilities when enabled.
- `src/modules/mcp-server/mcp-handlers-sampling.ts` handles inbound
  `sampling/createMessage` as a direct server method, not as a client-feature
  request embedded in an MRTR `InputRequiredResult`.
- `src/modules/mcp-server/mcp-handlers-elicitation.ts` still sends
  `sampling/elicit` for the legacy elicitation path, while draft tool calls
  already use an `elicitation/create` input-required result for `confirm`.
- Recent completed MCP tasks cover tools/list pagination, tool-list change
  notifications, bounded memory/knowledge resources, tool-result variants, and
  resource subscriptions; none owns the draft discovery/per-request lifecycle
  boundary.

## Initiative

MCP protocol fidelity: KOTA should not keep adding draft feature details on top
of a legacy lifecycle boundary that current clients cannot negotiate cleanly.

## Acceptance Evidence

- Focused MCP server protocol tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Test fixtures show `server/discover` working before initialization, a draft
  request succeeding with per-request `_meta` and no prior initialize, and the
  legacy initialize path still serving older clients.
- A focused assertion proves draft server capabilities exclude client-feature
  sampling/elicitation while preserving any explicitly legacy behavior.
