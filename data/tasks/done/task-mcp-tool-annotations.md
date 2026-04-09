---
id: task-mcp-tool-annotations
title: Add MCP tool annotations to expose risk and behavior hints to MCP clients
status: done
priority: p3
area: modules
summary: The 2025-03-26 MCP spec added tool annotations (readOnlyHint, destructiveHint, openWorldHint, idempotentHint). Populating these from KOTA's guardrail risk classification lets MCP clients make smarter tool selection decisions without requiring extra prompting.
created_at: 2026-04-02T13:57:40Z
updated_at: 2026-04-08T17:27:34Z
---

## Problem

KOTA's MCP server exposes its tool set via `tools/list` but returns no `annotations`
on any tool. The 2025-03-26 MCP specification added an `annotations` field to the
`Tool` object that hints at side-effect semantics:

- `readOnlyHint` — the tool does not modify state.
- `destructiveHint` — the tool may delete or overwrite data.
- `idempotentHint` — repeated calls produce the same outcome.
- `openWorldHint` — the tool communicates with external systems.

KOTA already classifies tool risk in `src/guardrails-classify.ts` (read-only, write,
destructive, network tiers). This classification is a natural source for MCP
annotations. Without annotations, MCP clients (Claude Desktop, IDEs) cannot
distinguish a file-read tool from a `rm -rf` equivalent without inspecting tool names
or descriptions heuristically.

## Desired Outcome

- `tools/list` response includes an `annotations` object for each tool, derived from
  KOTA's existing guardrail risk tier:
  - `read` tier → `{ readOnlyHint: true }`.
  - `write` tier → `{ readOnlyHint: false, destructiveHint: false }`.
  - `destructive` tier → `{ readOnlyHint: false, destructiveHint: true }`.
  - `network` tier → `{ openWorldHint: true }`.
  - Combinations apply when multiple tiers match.
- The MCP server sets `annotations` alongside `name`, `description`, and `inputSchema`
  when building the tool list in `src/mcp/server.ts`.

## Constraints

- Derive annotations from the guardrail tier — do not add a separate annotation
  registry or require module authors to declare hints manually.
- If a tool's tier is unknown, omit `annotations` rather than defaulting to destructive.
- No breaking change to the tools KOTA registers; only the `tools/list` response format changes.
- Requires MCP SDK support for `annotations` in the `Tool` type; pin to an SDK version
  that includes the 2025-03-26 spec additions if not already on one.
- Add a unit test in `src/mcp/server.test.ts` verifying that read-tier tools have
  `readOnlyHint: true` and destructive-tier tools have `destructiveHint: true`.

## Done When

- `tools/list` response includes `annotations` for KOTA's built-in tools.
- Read tools (`read_file`, `list_directory`, etc.) have `readOnlyHint: true`.
- Destructive tools have `destructiveHint: true`.
- Network tools have `openWorldHint: true`.
- Unit test covers annotation mapping for each tier.
