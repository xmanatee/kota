---
status: done
---

# Add kota module CLI for operator visibility into loaded modules

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
