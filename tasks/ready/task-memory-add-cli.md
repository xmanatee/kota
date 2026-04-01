---
id: task-memory-add-cli
title: Add kota memory add subcommand for manual memory entry creation
status: ready
priority: p3
area: operator-ux
summary: The memory CLI has list/search/delete but no add subcommand. Operators cannot create memory entries from the shell — only agents can write to the memory store.
created_at: 2026-04-01T06:00:00Z
updated_at: 2026-04-01T06:00:00Z
---

## Problem

`kota memory` exposes list, search, and delete but has no `add` subcommand.
The `MemoryStore.add()` method exists and accepts content and optional metadata,
but there is no shell-facing path to invoke it.

Operators who want to seed the memory store manually — for instance, to pre-populate
agent context before a first run — must ask an agent to do it or write raw files
into the store directory. There is no parity with `kota knowledge add`.

## Desired Outcome

A `kota memory add` subcommand that creates a new memory entry:

- `--content <text>` or reads from stdin when `--content` is omitted
- `--tag <tag>` (repeatable, optional)

On success, prints the new entry ID. On failure, exits non-zero with a descriptive error.

## Constraints

- Use the existing `MemoryStore` write API directly — do not duplicate write logic.
- Reading from stdin allows piping: `echo "remember X" | kota memory add`.
- No new dependencies.
- Follow the existing `registerMemoryCommands` pattern in `memory-cli.ts`.

## Done When

- `kota memory add --content "some note"` creates and prints an entry ID.
- `echo "some note" | kota memory add` works without `--content`.
- A basic test covers the create path.
