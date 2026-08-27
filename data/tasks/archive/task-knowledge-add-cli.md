---
status: done
---

# Add kota knowledge add subcommand for manual entry creation

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
