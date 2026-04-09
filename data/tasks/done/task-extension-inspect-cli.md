---
id: task-module-inspect-cli
title: Add kota module CLI for operator visibility into loaded modules
status: done
priority: p3
area: cli
summary: Operators have no CLI way to list or inspect what modules are loaded or what each one contributes. As the module set grows and contributed workflows/tools become more common, a kota module list/inspect command helps operators understand what is running.
created_at: 2026-03-30T15:00:00Z
updated_at: 2026-03-30T16:44:58Z
---

## Problem

`ModuleLoader` tracks all loaded modules and their contributed tools,
workflows, commands, and routes, but there is no CLI surface for operators to
inspect this. When something goes wrong — a contributed workflow not triggering,
a tool not appearing, or a dependency missing — the only diagnostic path is
reading source files.

`kota --help` lists CLI commands, but does not show which module contributed
them, how many tools each module registered, or what workflows are
contributed. `kota workflow definitions` (when built) will show workflow
definitions, but won't attribute them to their contributing module.

## Desired Outcome

- `kota module list` — list loaded modules with name, version, and a brief
  count summary (tools, workflows, commands, routes contributed).
- `kota module inspect <name>` — show full detail for one module: all
  contributed tools, workflows, commands, routes, skills, agents, and
  dependencies.
- Output is human-readable by default; `--json` flag for scripting.

## Constraints

- Read from the in-process `ModuleLoader` state — do not re-parse module
  source files.
- When the daemon is running, prefer daemon-side module state.
- Follow the same CLI registration pattern as other module commands.
- Keep the scope to inspection only — no add/remove/enable/disable in this task.

## Done When

- `kota module list` shows all loaded modules with contribution counts.
- `kota module inspect <name>` shows full detail for one module.
- `--json` flag works for both commands.
- Command appears in `kota --help`.
