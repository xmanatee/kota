---
id: task-knowledge-bulk-import
title: Add bulk knowledge import command to load entries from a JSON/JSONL file
status: ready
priority: p3
area: cli
summary: The kota knowledge CLI only supports adding entries one at a time. A bulk import command would let operators onboard documentation, runbooks, or reference material in a single operation.
created_at: 2026-04-02T07:14:02Z
updated_at: 2026-04-02T07:14:02Z
---

## Problem

`kota knowledge add` adds one entry per invocation. Operators who want to seed the
knowledge store from a docs directory, a JSON export, or a JSONL dump must write
shell loops or do it manually. There is no first-class bulk path.

## Desired Outcome

`kota knowledge import <file>` reads a file and creates knowledge entries from it:

- **JSONL**: one JSON object per line with at minimum `title` and `body` fields.
  Optional `tags` (array of strings) is also accepted.
- **JSON**: an array of the same objects.

After import, the command prints a summary: `Imported N entries, skipped M (missing title/body).`

## Constraints

- Read the file from disk; do not support stdin piping in this task.
- Validate each entry: skip (with a warning) any row missing `title` or `body`.
- Do not deduplicate — importing the same file twice creates duplicate entries. A
  `--skip-existing` flag is out of scope for this task.
- No changes to the knowledge store schema or provider interface — this is a CLI
  addition only.
- A `--dry-run` flag that prints what would be imported without writing is a nice-to-have
  but not required.

## Done When

- `kota knowledge import <file>` is available and documented in `--help`.
- JSONL and JSON array formats are both accepted.
- Invalid rows are skipped with a per-row warning; valid rows are committed.
- A final summary line is printed.
- The command is covered by at least a minimal unit test (file parsing + entry count).
