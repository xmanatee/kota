---
id: task-consolidate-agent-and-skill-registries
title: Consolidate agent and skill registries into dedicated extensions
status: backlog
priority: p3
area: architecture
summary: Agent and skill discovery and registration is spread across core files. Consolidating into focused extensions would clarify ownership and reduce core responsibilities around contributor registration.
created_at: 2026-04-09T06:34:00Z
updated_at: 2026-04-09T06:34:00Z
---

## Problem

KOTA has `SkillDef` and `AgentDef` contribution mechanisms but agent and skill discovery is
scattered across core files (`agents/` directory, `extension-context.ts` for registration,
`agent-cli.ts` for listing/inspection). The registry logic is decentralized, making it hard
to understand the full flow and difficult to extend with new discovery sources (e.g., pulling
agents/skills from an external registry).

## Desired Outcome

Two new extensions:

1. `src/extensions/agents/` - owns:
   - Built-in `explorer`, `builder`, `improver` agent definitions
   - `registerAgentCommands` and `kota agent` CLI surface
   - Agent registry singleton and lookup helpers
   - Extension context registration method

2. `src/extensions/skills/` - owns:
   - Skill discovery from `.kota/skills/` directory
   - Skill loading and validation
   - Built-in skill contributions from other extensions
   - `registerSkillCommands` and `kota skill` CLI surface (import, export, list)
   - Skill registry

Extensions contribute agents/skills via `ctx.registerAgent(...)` and `ctx.registerSkill(...)`.
Core loop imports agents/skills from these extensions.

## Constraints

- No change to agent/skill contribution or execution behavior.
- Built-in agents and skills remain discoverable and loadable.
- Workflow definitions can still reference agents by name.

## Done When

- `src/extensions/agents/` and `src/extensions/skills/` exist with full implementation.
- Built-in agent definitions move into the agents extension.
- Skill discovery and loading move into the skills extension.
- `kota agent` and `kota skill` commands are registered by their extensions.
- Core agent/skill lookup imports from these extensions.
- All existing agent/skill workflows work unchanged.
- Tests pass.

