---
id: task-extension-inspect-cli
title: Add kota extension CLI for operator visibility into loaded extensions
status: ready
priority: p3
area: cli
summary: Operators have no CLI way to list or inspect what extensions are loaded or what each one contributes. As the extension set grows and contributed workflows/tools become more common, a kota extension list/inspect command helps operators understand what is running.
created_at: 2026-03-30T15:00:00Z
updated_at: 2026-03-30T16:44:58Z
---

## Problem

`ExtensionLoader` tracks all loaded extensions and their contributed tools,
workflows, commands, and routes, but there is no CLI surface for operators to
inspect this. When something goes wrong — a contributed workflow not triggering,
a tool not appearing, or a dependency missing — the only diagnostic path is
reading source files.

`kota --help` lists CLI commands, but does not show which extension contributed
them, how many tools each extension registered, or what workflows are
contributed. `kota workflow definitions` (when built) will show workflow
definitions, but won't attribute them to their contributing extension.

## Desired Outcome

- `kota extension list` — list loaded extensions with name, version, and a brief
  count summary (tools, workflows, commands, routes contributed).
- `kota extension inspect <name>` — show full detail for one extension: all
  contributed tools, workflows, commands, routes, skills, agents, and
  dependencies.
- Output is human-readable by default; `--json` flag for scripting.

## Constraints

- Read from the in-process `ExtensionLoader` state — do not re-parse extension
  source files.
- When the daemon is running, prefer daemon-side extension state.
- Follow the same CLI registration pattern as other extension commands.
- Keep the scope to inspection only — no add/remove/enable/disable in this task.

## Done When

- `kota extension list` shows all loaded extensions with contribution counts.
- `kota extension inspect <name>` shows full detail for one extension.
- `--json` flag works for both commands.
- Command appears in `kota --help`.
