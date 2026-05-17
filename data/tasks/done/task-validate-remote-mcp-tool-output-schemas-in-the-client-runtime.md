---
id: task-validate-remote-mcp-tool-output-schemas-in-the-client-runtime
title: Validate remote MCP tool output schemas in the client runtime
status: done
priority: p2
area: core
summary: Preserve MCP tools/list outputSchema for remote server tools and validate remote structuredContent before it enters KOTA's neutral tool-result path.
created_at: 2026-05-17T01:08:38Z
updated_at: 2026-05-17T01:20:04Z
---

## Problem

KOTA now has strict structured-output contracts for KOTA-owned tools:
`KotaTool.output_schema` flows to the MCP server's `tools/list`, MCP
server calls validate structured output, and the shared local tool runner
validates successful KOTA tool results before they reach the agent loop.

The inbound MCP-client path is still weaker. `McpClient.listTools()` returns
remote `tools/list` data as a narrow `McpToolSchema` that drops
`outputSchema`, and `McpManager` turns remote tools into neutral KOTA tools
without preserving that schema. `McpClient.callTool()` preserves
`structuredContent`, but KOTA does not validate it against the remote tool's
advertised schema before the result enters `McpManager.executeTool()` and the
neutral tool-result path.

That leaves remote MCP tools with an advisory contract where local KOTA tools
are strict. A malformed remote structured result can be treated as a
successful tool result even when the remote server advertised the shape KOTA
should have validated.

## Desired Outcome

Remote MCP tool output schemas are preserved and enforced at the MCP client
boundary:

- `McpToolSchema` accepts and validates an optional remote `outputSchema`
  object from `tools/list`.
- `McpManager` stores the remote output schema with the namespaced tool entry
  and exposes it on the neutral `KotaTool.output_schema` field.
- `McpClient.callTool()` or `McpManager.executeTool()` validates successful
  remote `structuredContent` against the stored schema before returning a
  neutral `ToolResult`.
- A successful remote result missing `structuredContent` or violating the
  advertised schema is a loud MCP tool error, not a successful local tool
  result or successful telemetry event.
- Remote tools without `outputSchema`, remote execution errors, and
  malformed `tools/list` entries keep explicit existing behavior: no schema
  means no structured-output validation; malformed protocol data fails at the
  boundary.

## Constraints

- Keep MCP-client code in `src/core/mcp/`; the MCP server module remains the
  outbound KOTA-as-server surface.
- Reuse `src/core/tools/output-schema.ts` or the same
  `json-schema-validator` primitive. Do not introduce a second schema
  validator for remote MCP tools.
- Preserve the namespacing model (`mcp__<server>__<tool>`) and the existing
  remote-tool routing through `McpManager`.
- Do not require remote MCP servers to provide output schemas. The contract is
  strict only when a remote server advertises one.
- Do not silently coerce non-object `structuredContent` into an object. MCP
  structured output entering KOTA remains JSON-shaped protocol data and should
  be decoded once at the boundary.
- Do not broaden this task into a full MCP transport rewrite or Streamable
  HTTP support.

## Done When

- `McpClient.listTools()` preserves a valid remote `outputSchema` from
  `tools/list` and rejects or omits malformed tool definitions with a focused
  warning/error path consistent with existing MCP-client behavior.
- Namespaced remote tools returned by `McpManager.getTools()` include
  `output_schema` when the remote tool advertised `outputSchema`.
- A focused test proves a remote tool with matching `structuredContent`
  succeeds and preserves text blocks, rich blocks, metadata, and
  `structuredContent`.
- A focused test proves a remote tool with an advertised `outputSchema` but
  missing `structuredContent` is returned as an MCP tool error, not a
  successful `ToolResult`.
- A focused test proves a remote tool with schema-invalid
  `structuredContent` is returned as an MCP tool error, not a successful
  `ToolResult`.
- Existing MCP result-preservation, MCP server output-schema, and local
  tool-runner schema tests remain green.

## Source / Intent

Explorer run `2026-05-17T01-06-45-065Z-explorer-yacbw0` reviewed an empty
actionable queue. The strategic blocked alternatives are still
operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Validate remote MCP tool output schemas in the client runtime" --state ready --area core --priority p2 --summary "Preserve MCP tools/list outputSchema for remote server tools and validate remote structuredContent before it enters KOTA's neutral tool-result path."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools` is the
  official MCP draft Tools page. It documents `outputSchema` for tool
  definitions, structured tool results, and client-side validation of
  structured results against advertised schemas.

Local evidence:

- `data/tasks/done/task-expose-tool-output-schemas-through-mcp-toolslist.md`
  covered KOTA's outbound MCP `tools/list` mapping.
- `data/tasks/done/task-enforce-tool-output-schemas-in-the-local-tool-runner.md`
  covered the shared local KOTA tool runner.
- `src/core/mcp/client.ts` currently defines `McpToolSchema` with `name`,
  `description`, and `inputSchema`, but no `outputSchema`.
- `src/core/mcp/manager.ts` converts remote MCP tools to neutral `KotaTool`
  without preserving output schemas.
- `src/core/mcp/client.ts` preserves remote `structuredContent` from
  `tools/call`, so the result data exists but is not checked against the
  remote advertised contract.

## Initiative

MCP protocol fidelity: KOTA should enforce structured tool-result contracts
symmetrically for KOTA-owned tools exposed over MCP and remote MCP tools
consumed by KOTA.

## Acceptance Evidence

- Test transcript for focused MCP client/manager and existing schema suites,
  for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts src/core/tools/tool-runner-schema.integration.test.ts src/modules/mcp-server/server.test.ts`.
- Diff review shows one shared output-schema validation helper reused for
  local KOTA tools and remote MCP tools, with no MCP-client-only schema
  validator.
