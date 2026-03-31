---
id: task-web-ui-memory-panel
title: Add memory store browser panel to the web UI dashboard
status: ready
priority: p3
area: operator-ux
summary: Agent memory entries are only accessible via the CLI (`kota memory`). A web UI panel for browsing and inspecting memory entries would give operators a fast read-only view of what agents are retaining across sessions.
created_at: 2026-03-31T05:01:00Z
updated_at: 2026-03-31T05:28:00Z
---

## Problem

`kota memory list` and `kota memory show <id>` expose the memory store via the CLI,
but the web dashboard has no equivalent panel. The knowledge store browser is being
added (task-web-ui-knowledge-panel), but memory — agent-authored notes and observations
that influence future runs — remains invisible in the UI.

Operators cannot audit what agents are remembering without switching to the terminal.
There is also no way to spot-check whether memory entries are stale, redundant, or
incorrect without scripting.

## Desired Outcome

A "Memory" panel in the web UI dashboard that:
- Lists all memory entries with id, type/tag, and a short excerpt.
- Supports a simple text filter/search within the loaded entries.
- Shows full entry content on expansion or click.
- Follows the existing panel pattern established by the knowledge panel and approvals.

A `GET /api/memory` route returns the list; `GET /api/memory/:id` returns a single
entry. Read-only; no create/edit/delete from the web UI.

## Constraints

- Add server routes in a new `src/server/memory-routes.ts` following the pattern of
  `src/server/knowledge-routes.ts` (already landed).
- Use `MemoryProvider` from `ProviderRegistry`; do not bypass the provider abstraction.
- No changes to the memory store itself.
- Panel is static on load (no SSE needed).

## Done When

- `GET /api/memory` returns a list of memory entries (id, type, excerpt).
- `GET /api/memory/:id` returns full entry content.
- Memory panel renders in the web UI with text filter support.
- Existing web UI tests pass; new behavior covered by at least one test.
