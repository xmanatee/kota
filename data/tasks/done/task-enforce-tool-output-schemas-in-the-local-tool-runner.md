---
id: task-enforce-tool-output-schemas-in-the-local-tool-runner
title: Enforce tool output schemas in the local tool runner
status: done
priority: p2
area: core
summary: Move KotaTool output_schema validation into the shared tool execution path so local agent-loop tool calls fail loudly on malformed structuredContent instead of only enforcing the contract through the MCP server adapter.
created_at: 2026-05-17T00:34:33Z
updated_at: 2026-05-17T00:42:34Z
---

## Problem

KOTA's neutral `KotaTool` protocol now supports `output_schema`, and the MCP
server exposes that as MCP `outputSchema` while validating `structuredContent`
before returning a successful MCP tool call. That enforcement is currently
adapter-local. A KOTA-registered tool invoked through the normal agent loop can
declare `output_schema`, return malformed `structuredContent`, and still flow
through `executeTool` / `executeToolCalls` as a successful local result.

That leaves two meanings for the same protocol field: strict over MCP, advisory
inside KOTA. The tool contract should be enforced once at the shared execution
boundary so every local module tool and built-in tool follows the same rule.

## Desired Outcome

`output_schema` validation is part of the core local tool runner contract:

- a tool that declares `output_schema` must return conforming
  `structuredContent` for successful results;
- a successful result with missing or malformed `structuredContent` fails
  loudly before it is delivered to the agent loop, telemetry, or MCP adapter;
- MCP server validation reuses the shared helper or delegates to the already
  validated local runner path instead of carrying a second schema check;
- tools without `output_schema` and tool results marked as execution errors keep
  their existing behavior.

## Constraints

- Keep the canonical field on `KotaTool`; do not add an MCP-only schema or a
  second tool-definition type.
- Reuse `src/core/util/json-schema-validator.ts` or extract the smallest shared
  helper needed. Do not introduce a broad JSON-schema dependency for this slice.
- Preserve external MCP tool handling: tools executed through `McpManager` only
  have the remote server's contract unless KOTA has a local `KotaTool`
  definition for them.
- Preserve local runner error semantics deliberately. A malformed successful
  result must not be returned as success; whether the boundary reports an
  `is_error` tool result or throws should match the existing runner/agent-loop
  contract and be covered by tests.
- Do not require broad per-tool `output_schema` coverage. This task is about
  enforcement for tools that already declare a schema.

## Done When

- `executeTool` validates successful results for registered tools with
  `output_schema` and fails loudly when `structuredContent` is missing.
- `executeTool` validates successful results for registered tools with
  `output_schema` and fails loudly when `structuredContent` violates the schema.
- `executeToolCalls` cannot record a schema-invalid structured result as a
  successful local tool call or successful telemetry event.
- `src/modules/mcp-server/mcp-handlers-tools.ts` no longer owns a divergent
  copy of output-schema validation for KOTA-registered tools; any remaining MCP
  adapter check is a thin boundary check with focused tests.
- Existing MCP output-schema tests remain green, and focused core-tool tests
  prove both valid and invalid local runner behavior.

## Source / Intent

Explorer run `2026-05-17T00-32-15-983Z-explorer-6w2jqj` reviewed an empty
actionable queue. The strategic blocked alternatives are still
operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The freshest watchlist source remains the official MCP draft Tools page:

- `https://modelcontextprotocol.io/specification/draft/server/tools`

The page documents tool `outputSchema` and says servers must provide structured
results conforming to that schema when one is advertised. KOTA already landed
the MCP-facing slice in
`data/tasks/done/task-expose-tool-output-schemas-through-mcp-toolslist.md`;
this task is the local execution-boundary follow-up so the same neutral
protocol field is not weaker inside the agent loop than it is over MCP.

The scaffold command was attempted first:

```
pnpm kota task create "Enforce tool output schemas in the local tool runner" --state ready --area core --priority p2 --summary "Move KotaTool output_schema validation into the shared tool execution path so local agent-loop tool calls fail loudly on malformed structuredContent instead of only enforcing the contract through the MCP server adapter."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

Local evidence:

- `src/core/agent-harness/message-protocol.ts` defines `KotaTool.output_schema`.
- `src/modules/mcp-server/mcp-handlers-tools.ts` validates
  `structuredContent` against `output_schema` for MCP `tools/call`.
- `src/core/tools/index.ts` executes registered local tools without checking
  the returned `structuredContent` against the registered tool definition.
- `src/core/tools/tool-runner.ts` records local tool telemetry from the raw
  result it receives, so schema-invalid structured results can currently be
  counted as successful local calls.

## Initiative

Tool protocol fidelity: KOTA's neutral tool contracts should be enforced at the
shared execution boundary, not only at one external adapter.

## Acceptance Evidence

- Test transcript for focused core-tool and MCP-server coverage, for example
  `pnpm test src/core/tools/index.test.ts src/core/tools/tool-runner.test.ts src/modules/mcp-server/server.test.ts`.
- Diff review shows one shared output-schema validation path, no duplicate
  MCP-only contract, and no successful local tool result carrying invalid
  `structuredContent`.
