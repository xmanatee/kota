---
id: task-handle-remote-mcp-input-required-tool-results
title: Handle remote MCP input-required tool results explicitly
status: ready
priority: p2
area: core
summary: Decode MCP draft input_required tool results from remote servers and route or fail them through an explicit KOTA client-runtime contract instead of treating them as malformed content.
created_at: 2026-05-17T02:16:06Z
updated_at: 2026-05-17T02:16:06Z
---

## Problem

KOTA now preserves rich MCP tool results, validates remote output schemas, and
its MCP server can speak the draft `complete` / `input_required` tool-result
variants. The inbound client path is still legacy-shaped:

- `src/core/mcp/client.ts` initializes remote MCP servers with protocol version
  `2024-11-05`.
- `decodeCallToolResult` requires a top-level `content` array and ignores
  `resultType`.
- A remote server that returns draft `resultType: "input_required"` with
  `inputRequests` and `requestState` is reported as malformed content instead
  of as an explicit unsupported or routable input request.

That makes a valid remote MCP tool interaction look like a broken server and
drops the exact input contract KOTA would need to either ask an operator or
fail honestly.

## Desired Outcome

The MCP client runtime has a strict inbound contract for draft tool-result
variants:

- `McpClient` negotiates protocol version deliberately instead of hardcoding
  only the legacy version without recording the selected result contract.
- `McpClient.callTool()` decodes completed results and input-required results
  as a discriminated TypeScript union. Legacy content-only results remain a
  named compatibility branch.
- `McpManager.executeTool()` handles a remote `input_required` result through
  one explicit KOTA behavior: either route the request through an existing
  operator/approval surface when the runtime context can do that safely, or
  return a typed `is_error` tool result that names remote input as unsupported
  and preserves the request metadata for diagnostics.
- Remote `inputRequests`, `requestState`, and retry-related fields are never
  erased by a generic malformed-result error.

## Constraints

- Keep this work in `src/core/mcp/`. Do not import the MCP server module back
  into core.
- Do not add a second owner-question, approval, or prompt surface just for MCP.
  If this slice cannot safely route remote input to an existing surface, fail
  loudly and leave a small follow-up task.
- Preserve current text-only and structured-result behavior for legacy remote
  MCP servers.
- Do not silently retry `tools/call` with fabricated `inputResponses`.
- Treat remote MCP payloads as untrusted external I/O. Validate shape once at
  the MCP boundary and expose a typed neutral result afterward.

## Done When

- `McpClient` records the negotiated MCP protocol version and tests cover the
  legacy and draft branches.
- A focused client test proves a draft `resultType: "complete"` result decodes
  without dropping `content`, `structuredContent`, `_meta`, rich content blocks,
  or `isError`.
- A focused client/manager test proves a draft `resultType: "input_required"`
  result is not reported as malformed `content`; it becomes the explicit KOTA
  behavior chosen in this task, with `inputRequests` and `requestState`
  preserved in diagnostics.
- Malformed input-required payloads fail with precise MCP boundary errors.
- Existing MCP client, manager, server, output-schema, and tool-result
  preservation tests remain green.

## Source / Intent

Explorer run `2026-05-17T02-13-49-962Z-explorer-gmcu2y` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Handle remote MCP input-required tool results explicitly" --state ready --area core --priority p2 --summary "Decode MCP draft input_required tool results from remote servers and route or fail them through an explicit KOTA client-runtime contract instead of treating them as malformed content."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools` documents
  draft tool-result variants, including completed results and input-required
  results with request state plus retry-time input responses.

Local evidence:

- `src/core/mcp/client.ts` hardcodes initialize `protocolVersion:
  "2024-11-05"` and decodes `tools/call` results by requiring `content`.
- `src/core/mcp/manager.ts` catches client decode failures and returns generic
  `MCP tool error: ...` text to the agent loop.
- `src/modules/mcp-server/mcp-handlers-tools.ts` and
  `data/tasks/done/task-support-mcp-draft-tool-result-variants.md` cover
  KOTA as an MCP server, not KOTA as a client consuming remote input-required
  results.
- `data/tasks/done/task-validate-remote-mcp-tool-output-schemas-in-the-client-runtime.md`
  covers remote `outputSchema` validation but not `input_required`.

## Initiative

MCP protocol fidelity: KOTA should consume remote MCP tools through the same
strict protocol boundary it exposes to external MCP clients.

## Acceptance Evidence

- Test transcript for focused MCP client and manager coverage, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Diff review shows a typed inbound MCP tool-result union, no MCP-server import
  into core, and no generic malformed-content error for valid remote
  `input_required` results.
