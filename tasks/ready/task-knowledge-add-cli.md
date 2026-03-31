---
id: task-knowledge-add-cli
title: Add kota knowledge add subcommand for manual entry creation
status: ready
priority: p2
area: operator-ux
summary: The knowledge CLI has list/search/show/delete but no add subcommand. Operators cannot create knowledge entries from the shell without writing files manually or using the agent API.
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T06:00:00Z
---

## Problem

`kota knowledge` exposes list, search, show, and delete but has no `add` subcommand.
The `KnowledgeStore.create()` method exists and accepts title, content, type, tags,
status, and scope, but it is only callable from TypeScript, not from the shell.

Operators who want to seed knowledge manually — capturing a reference document,
a decision record, or a project-specific fact — must edit files directly in
`.kota/knowledge/` or ask an agent to do it. There is no first-class operator-facing
way to insert a knowledge entry from the CLI.

## Desired Outcome

A `kota knowledge add` subcommand that creates a new knowledge entry:

- `--title <title>` (required)
- `--content <text>` or reads from stdin when `--content` is omitted
- `--type <type>` (default: `note`)
- `--tag <tag>` (repeatable)
- `--status <status>` (default: `active`)
- `--scope project|global` (default: `project`)

On success, prints the new entry ID. On failure, exits non-zero with a descriptive error.

## Constraints

- Use `KnowledgeStore.create()` directly — do not duplicate the write logic.
- Reading from stdin allows piping: `echo "some content" | kota knowledge add --title "Foo"`.
- No new dependencies.
- Follow the existing `registerKnowledgeCommands` pattern in `memory-cli.ts`.

## Done When

- `kota knowledge add --title "My Note" --content "body text"` creates and prints an entry ID.
- `echo "body" | kota knowledge add --title "Piped"` works without `--content`.
- `--tag`, `--type`, `--status`, and `--scope` flags are accepted and applied.
- A unit test covers the basic create path.
