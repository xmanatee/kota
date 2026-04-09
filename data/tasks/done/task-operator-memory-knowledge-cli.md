---
id: task-operator-memory-knowledge-cli
title: Add CLI commands for memory and knowledge stores
status: done
priority: p2
area: cli
summary: Operators have no direct CLI access to the memory and knowledge stores. Currently the only way to interact with these stores is through an agent session. Adding kota memory and kota knowledge subcommands gives operators direct read/write control.
created_at: 2026-03-27T18:33:05Z
updated_at: 2026-03-28T01:35:31Z
---

## Problem

The memory store (global notes the agent recalls across sessions) and knowledge store (structured reference entries with tags and full-text search) are rich runtime stores, but operators have no direct CLI interface to read or manage them. The only access path is through an active agent session. This makes it difficult to inspect what the agent knows, audit entries, or correct bad data without spinning up an agent.

## Desired Outcome

- `kota memory list` — list recent memory entries
- `kota memory search <query>` — search memory entries by keyword
- `kota memory delete <id>` — delete a memory entry
- `kota knowledge list` — list knowledge entries (optionally filtered by tag or status)
- `kota knowledge search <query>` — full-text search knowledge entries
- `kota knowledge show <id>` — print a single knowledge entry
- `kota knowledge delete <id>` — delete a knowledge entry

## Constraints

- Use the existing `getMemoryStore()` and `getKnowledgeStore(cwd)` APIs — do not bypass or duplicate them.
- Follow the same CLI registration pattern as `registerHistoryCommands`, `registerTaskCommands`, etc.
- Output format should be human-readable tables or compact plain text (not raw JSON by default).
- Scope knowledge commands to the current working directory (project-scoped). Keep global knowledge access out of scope for now.

## Done When

- `kota memory list` and `kota memory search <query>` work without starting an agent session.
- `kota knowledge list`, `kota knowledge search <query>`, and `kota knowledge show <id>` work.
- At least `kota memory delete` and `kota knowledge delete` work for cleanup.
- Commands appear in `kota --help` output.
