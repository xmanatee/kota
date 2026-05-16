---
id: task-preserve-mcp-tool-result-metadata-through-the-client-runtime
title: Preserve MCP tool result metadata through the client runtime
status: ready
priority: p2
area: core
summary: Keep MCP CallToolResult structuredContent, _meta, non-text content, and execution-error shape intact when external MCP tools are routed into KOTA sessions.
created_at: 2026-05-16T09:24:49Z
updated_at: 2026-05-16T09:24:49Z
---

## Problem

KOTA can consume external MCP servers through `src/core/mcp/`, but the current
client boundary flattens every `tools/call` response into a single text string:

- `McpClient.callTool()` narrows `CallToolResult.content` to text blocks only.
- `McpManager.executeTool()` returns `{ content, is_error }` and drops
  `structuredContent`, `_meta`, annotations, embedded resources, audio, and
  any future non-text result content.
- The neutral `ToolResult` / `KotaToolResultBlock` protocol only preserves
  text/image blocks today, so even a richer MCP client result has no explicit
  path into the session transcript.

That is a protocol loss at the same boundary that decides what the model can
learn from an external tool. It is also hard to detect later because a text
fallback can make the call look successful while cache metadata, structured
output, or resource handles were silently discarded.

## Desired Outcome

KOTA preserves MCP tool result structure across the MCP client, manager, tool
runner, and neutral agent message boundary. A builder should make the smallest
strict protocol extension that lets an external MCP tool result retain:

- `content` blocks beyond plain text when KOTA can represent them;
- `structuredContent` as structured data, not as an ad hoc string appendix;
- `_meta` as metadata that survives into subsequent tool-result handling;
- `isError` as the tool-execution error bit the model can use to self-correct.

If a specific MCP content kind still cannot be passed to a model provider, the
runtime should preserve it explicitly in the neutral transcript or fail loudly
at that adapter boundary. It should not silently erase the field at
`src/core/mcp/`.

## Constraints

- Keep the MCP client side in `src/core/mcp/`; the MCP server module remains
  separate and should not be imported back into core.
- Extend strict typed protocols rather than adding loose
  `Record<string, unknown>` bags throughout the loop. Optional fields are
  acceptable only where the MCP protocol makes absence a real state.
- Do not stringify structured content merely to satisfy existing tests. Text
  fallback blocks may remain for model readability, but the structured payload
  must remain separately recoverable.
- Preserve existing text-only MCP behavior and error handling.
- Treat external MCP server output as untrusted tool output; do not bypass the
  existing injection-defense and tool-result masking/pruning paths.

## Done When

- `McpClient.callTool()` has a typed result shape that includes MCP
  `content`, `structuredContent`, `_meta`, and `isError`.
- `McpManager.executeTool()` maps MCP call results into KOTA's neutral
  `ToolResult` without dropping structured result fields.
- The session tool-result path preserves the added fields into
  `KotaToolResultBlock` or a clearly named neutral sibling type, and provider
  adapters either pass them through or reject unsupported fields explicitly.
- Focused tests cover text-only results, structured content, `_meta`, image or
  non-text content, tool-execution errors, and protocol-level MCP errors.
- Existing message pruning/masking behavior still handles enriched tool
  results without erasing the visible placeholder semantics.

## Source / Intent

Explorer run `2026-05-16T09-21-41-257Z-explorer-nmwlrm` reviewed the empty
queue. The strategic blocked alternatives are all still gated on
operator-captured evidence, so this opens a ready core-runtime slice instead
of adding another blocked task.

External signals checked during the run:

- `https://modelcontextprotocol.io/specification/2025-11-25/schema` defines
  `CallToolResult` with `content`, optional `structuredContent`, optional
  `_meta`, and optional `isError`.
- `https://modelcontextprotocol.io/specification/2025-11-25/server/tools`
  documents structured tool results and says clients should provide tool
  execution errors to models so they can self-correct.
- `https://github.com/openai/codex/pulls` on 2026-05-16 showed active Codex
  work preserving MCP result metadata in MCP tool-call result and execution
  event paths, reinforcing that metadata loss at agent-tool boundaries is a
  practical runtime issue, not just a spec completeness detail.

Local evidence:

- `src/core/mcp/client.ts`
- `src/core/mcp/manager.ts`
- `src/core/tools/tool-result.ts`
- `src/core/agent-harness/message-protocol.ts`
- `src/core/tools/tool-runner.ts`
- `src/core/loop/observation-masking.ts`

## Initiative

MCP protocol fidelity: KOTA should consume external MCP tools through the same
strict neutral runtime protocol it uses for built-in tools, preserving
structured observations until a deliberate adapter boundary says otherwise.

## Acceptance Evidence

- Test transcript for focused MCP and tool-result protocol suites, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts src/core/tools/tool-runner.test.ts src/core/loop/observation-masking.test.ts`.
- A small fixture MCP server in tests returns text, structured content,
  `_meta`, a non-text content block, and `isError: true`; assertions prove KOTA
  preserves each field or fails at a named unsupported adapter boundary.
- Diff review shows no string-only coercion of `structuredContent` / `_meta`
  in `src/core/mcp/`.
