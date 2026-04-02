---
id: task-mcp-resources-knowledge-memory
title: Expose knowledge and memory stores as MCP resources
status: done
priority: p3
area: extensions
summary: The MCP server already exposes task queue, workflow status, and recent runs as resources. Exposing knowledge entries and memory notes as MCP resources lets Claude Desktop and other MCP clients read KOTA's stores without bespoke tool calls.
created_at: 2026-04-02T13:41:47Z
updated_at: 2026-04-02T13:57:40Z
---

## Problem

KOTA's MCP server (`src/mcp/resources.ts`) exposes three read-only resources:
`kota://tasks/ready`, `kota://workflow/status`, and `kota://workflow/runs/recent`.
The knowledge and memory stores are only accessible via tools (`kota_memory_list`,
`kota_knowledge_list`, etc.), which require an LLM invocation to invoke.

MCP clients that want to read KOTA's knowledge base or memory notes to provide
grounding context must issue tool calls rather than reading resources — a heavier
and less composable pattern. Resources are the right primitive for read-only,
browsable store content.

## Desired Outcome

Two new MCP resources added to `src/mcp/resources.ts`:

- `kota://memory` — all memory entries as a JSON array (`[{id, content, tags, createdAt}]`).
- `kota://knowledge` — all knowledge entries as a JSON array (`[{id, title, content, tags, source, createdAt}]`).

Both resources are read-only snapshots (no subscription needed). The MCP server
already handles `resources/list` and `resources/read` dispatch; adding these is
a matter of contributing entries to `KOTA_RESOURCES` and implementing their readers.

## Constraints

- Read via the existing `MemoryProvider` and `KnowledgeProvider` singletons — no
  direct file reads.
- If a provider is not configured (returns empty), the resource returns an empty
  array rather than an error.
- No new MCP protocol capabilities required; both resources are static (no subscribe).
- Keep `src/mcp/resources.ts` and `src/mcp/server.ts` as the only changed files.
- Document the two new resources in `docs/MCP.md`.

## Done When

- `kota://memory` and `kota://knowledge` appear in `resources/list`.
- `resources/read` returns a JSON array for each.
- Unit tests in `src/mcp/server.test.ts` cover list and read for both new resources.
- `docs/MCP.md` documents the new resources in the resources section.
