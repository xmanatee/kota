---
id: task-expose-tool-output-schemas-through-mcp-toolslist
title: Expose tool output schemas through MCP tools/list
status: ready
priority: p2
area: modules
summary: Add an optional structured-output schema to KOTA tool definitions and expose it as MCP outputSchema, with validation so structured tool results cannot drift silently from their advertised contract.
created_at: 2026-05-16T10:55:39Z
updated_at: 2026-05-16T10:55:39Z
---

## Problem

KOTA now preserves rich MCP tool results on both sides of the protocol:
the client runtime keeps `structuredContent`, metadata, rich content
blocks, and `isError`, and the MCP server can speak the draft
`complete` and `input_required` result variants. The remaining gap is
the contract above those results. KOTA's neutral `KotaTool` definition
only declares `input_schema`, so a tool that returns structured data has
no typed way to advertise the shape of that data.

The current MCP draft Tools spec includes `outputSchema` on tool
definitions and says structured results must conform to the advertised
schema when one is provided. Without a KOTA-side output schema, MCP
clients cannot validate KOTA tool results ahead of use, and KOTA cannot
fail loudly when an internal tool runner starts returning malformed
structured content.

## Desired Outcome

KOTA's tool protocol can optionally declare a structured output schema,
and the MCP server exposes that contract faithfully:

- `KotaTool` gains a narrow optional output-schema field using the same
  strict JSON-schema style as `input_schema`.
- Module-contributed tools that already return stable
  `structuredContent` add output schemas where the shape is durable.
- `src/modules/mcp-server/mcp-handlers-tools.ts` maps the neutral field
  to MCP `outputSchema` in `tools/list`.
- Tool execution validates `structuredContent` against the declared
  output schema before returning a successful result through MCP.
- Schema mismatch is a loud internal/protocol error with a focused test,
  not a text-only warning hidden inside a successful tool result.

## Constraints

- Keep the canonical tool protocol in
  `src/core/agent-harness/message-protocol.ts`; do not add an
  MCP-only parallel tool definition shape.
- Preserve the existing `input_schema` field name. Do not rename tools
  to a pure MCP shape or introduce a compatibility alias.
- Make the field optional only because many tools intentionally return
  unstructured text. For tools that declare it, the runner must produce
  conforming `structuredContent`.
- Reuse an existing schema validator if one is already suitable. If a
  helper is needed, put it at the narrowest shared boundary and avoid a
  second workflow-only validator.
- Do not require every tool to gain a schema in this slice. Start with a
  representative module tool or test fixture that proves the protocol,
  and leave broad per-tool coverage to follow-up work only if it is
  still useful.
- Keep exact MCP wire details in source types and focused tests, not in
  durable docs.

## Done When

- `KotaTool` has an optional structured output schema field with strict
  typing and no loose result bag.
- `kotaToolToMcp` includes `outputSchema` when the neutral tool declares
  one, and omits it otherwise.
- A focused MCP server test proves `tools/list` exposes `outputSchema`
  for a module tool that declares one.
- A focused MCP server test proves a structured result conforming to
  the schema succeeds without dropping `structuredContent`, `_meta`,
  annotations, or `isError`.
- A focused MCP server test proves a structured result that violates the
  declared output schema fails loudly at the MCP adapter boundary.
- Existing MCP client/server result-variant and metadata-preservation
  tests remain green.

## Source / Intent

Explorer run `2026-05-16T10-53-27-491Z-explorer-ai4e9d` reviewed an
empty actionable queue. The strategic blocked alternatives are still
operator-capture gated and not movable, so this opens one ready module
slice from the current MCP draft instead of adding another blocked item.

The scaffold command was attempted first:

```
pnpm kota task create "Expose tool output schemas through MCP tools/list" --state ready --area modules --priority p2 --summary "Add an optional structured-output schema to KOTA tool definitions and expose it as MCP outputSchema, with validation so structured tool results cannot drift silently from their advertised contract."
```

It failed before writing a file because the command's local preflight
returned `Fatal: fetch failed` in the network-restricted workflow
sandbox. This file follows the same normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools`
  is the official MCP draft Tools page. It documents tool
  `outputSchema`, structured content, and the requirement that servers
  provide structured results conforming to the advertised schema when
  an output schema is present.

Local evidence:

- `src/core/agent-harness/message-protocol.ts` defines `KotaTool` with
  `name`, `description`, and `input_schema`, but no output schema.
- `src/modules/mcp-server/mcp-handlers-tools.ts` maps KOTA tools to MCP
  with `name`, `description`, and `inputSchema` only.
- `src/core/tools/tool-result.ts` already supports `structuredContent`,
  so the result side exists but the definition-side contract does not.
- `data/tasks/done/task-preserve-mcp-tool-result-metadata-through-the-client-runtime.md`
  and
  `data/tasks/done/task-support-mcp-draft-tool-result-variants.md`
  cover result preservation and result variants, but not advertised
  output schemas.

## Initiative

MCP protocol fidelity: KOTA should advertise and enforce structured tool
result contracts at the same strict protocol boundary where it now
preserves rich tool result data.

## Acceptance Evidence

- Test transcript for focused MCP server and tool-protocol coverage, for
  example `pnpm test src/modules/mcp-server/server.test.ts`.
- Diff review shows one neutral output-schema field flowing from
  `KotaTool` to MCP `tools/list`, with schema validation at the adapter
  boundary and no MCP-only duplicate tool contract.
