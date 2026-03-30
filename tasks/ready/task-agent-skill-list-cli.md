---
id: task-agent-skill-list-cli
title: Add kota agent and kota skill CLI commands for operator visibility
status: ready
priority: p3
area: cli
summary: Operators have no CLI way to list registered agents or available skills. As extensions contribute more agents and skills, operators need a direct way to inspect what's loaded without reading source files.
created_at: 2026-03-30T15:14:28Z
updated_at: 2026-03-30T17:10:57Z
---

## Problem

`BUILTIN_AGENTS` defines explorer, builder, and improver. Extensions can contribute
additional agents via `KotaExtension.agents`. Skills are contributed similarly via
`KotaExtension.skills`. But there is no CLI to list either.

Operators who want to know which agents are registered, what their roles are, or
which skills are available must read source files or extension definitions. This gap
grows as the extension set expands and contributed agents/skills become more common.

The pattern is already established by `kota memory list`, `kota knowledge list`, and
the planned `kota workflow definitions` and `kota extension list` commands.

## Desired Outcome

- `kota agent list` — lists all registered agents (built-in + contributed) with name,
  role summary, model, and write scope.
- `kota agent inspect <name>` — shows full detail for one agent: role, model defaults,
  tool policy, skill list, write scope.
- `kota skill list` — lists all registered skills with name and source (which extension
  contributed it).
- Both commands support `--json` for scripting.

## Constraints

- Read from in-process agent and skill registries — do not re-parse source files.
- Follow the registration pattern established by `registerMemoryCommands` and
  `registerKnowledgeCommands` in `memory-cli.ts`.
- When the daemon is running, prefer daemon-side state where the daemon exposes it;
  fall back to local registry reads offline.
- Keep scope to inspection only — no add/remove/enable/disable in this task.

## Done When

- `kota agent list` shows all registered agents with name, role, and model.
- `kota agent inspect <name>` shows full agent detail.
- `kota skill list` shows all registered skills with name and contributing extension.
- `--json` flag works for all commands.
- Commands are registered in `cli.ts` and appear in `kota --help`.
