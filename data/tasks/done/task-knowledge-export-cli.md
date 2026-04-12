---
id: task-knowledge-export-cli
title: Add knowledge export CLI command to complement the existing import command
status: done
priority: p2
area: modules
summary: The knowledge module has an import command but no export. Operators cannot back up, transfer, or share knowledge entries between projects or instances.
created_at: 2026-04-12T05:36:07Z
updated_at: 2026-04-12T07:53:46.693Z
---

## Problem

`kota knowledge import <file>` exists and supports JSON/JSONL input. There is
no corresponding `kota knowledge export` command. This asymmetry means:

- No programmatic backup of knowledge entries.
- No way to transfer entries between project instances.
- No way to share curated knowledge sets across repos.

The knowledge store holds structured reference entries that accumulate over
time (run insights, research findings, domain notes). Losing them to a
corrupted `.kota/data/` directory or wanting to seed a new project from an
existing one has no supported path.

## Desired Outcome

A `kota knowledge export` CLI command that writes knowledge entries to
stdout or a file in the same JSON/JSONL format that `import` accepts.

Supports filtering by: `--type`, `--status`, `--tags`, `--scope`
(project/global). Defaults to exporting all project-scoped entries.

Round-trip: `kota knowledge export | kota knowledge import -` produces an
identical store (idempotent on id).

## Constraints

- Output format must be compatible with the existing `parseImportEntries()`
  function so import/export are symmetric.
- Keep the command in `src/modules/knowledge/cli.ts` alongside the import
  command.
- Do not add new dependencies for serialization.

## Done When

- `kota knowledge export` writes entries to stdout in JSON or JSONL format.
- Filter flags (`--type`, `--status`, `--tags`, `--scope`) work correctly.
- Round-trip with import produces identical entries.
- Tests cover export, filtering, and round-trip.
