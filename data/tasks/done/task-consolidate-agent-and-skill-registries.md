---
id: task-consolidate-agent-and-skill-registries
title: Consolidate agent and skill registries into dedicated modules
status: done
priority: p2
area: architecture
summary: Agent and skill discovery and registration is spread across core files. Consolidating into focused modules would clarify ownership and reduce core responsibilities around contributor registration.
created_at: 2026-04-09T06:34:00Z
updated_at: 2026-04-09T06:19:00Z
---

## Problem

KOTA has `SkillDef` and `AgentDef` contribution mechanisms but agent and skill ownership
is split across core files: `src/agents/index.ts` holds the built-in agent registry,
`src/agent-cli.ts` provides `registerAgentCommands` and `registerSkillCommands` (both still
imported by core `src/cli.ts`), and module context wires registration. Recent builder work
moved most operator CLI commands into owning modules, but the agent and skill CLI surfaces
remain in core. This is the remaining visible debt from that migration.

## Desired Outcome

Two new modules:

1. `src/modules/agents/` - owns:
   - Built-in `explorer`, `builder`, `improver` agent definitions
   - `registerAgentCommands` and `kota agent` CLI surface
   - Agent registry singleton and lookup helpers
   - Module context registration method

2. `src/modules/skills/` - owns:
   - Skill discovery from `.kota/skills/` directory
   - Skill loading and validation
   - Built-in skill contributions from other modules
   - `registerSkillCommands` and `kota skill` CLI surface (import, export, list)
   - Skill registry

Modules contribute agents/skills via `ctx.registerAgent(...)` and `ctx.registerSkill(...)`.
Core loop imports agents/skills from these modules.

## Constraints

- No change to agent/skill contribution or execution behavior.
- Built-in agents and skills remain discoverable and loadable.
- Workflow definitions can still reference agents by name.

## Done When

- `src/modules/agents/` and `src/modules/skills/` exist with full implementation.
- Built-in agent definitions move into the agents module.
- Skill discovery and loading move into the skills module.
- `kota agent` and `kota skill` commands are registered by their modules.
- Core agent/skill lookup imports from these modules.
- All existing agent/skill workflows work unchanged.
- Tests pass.

