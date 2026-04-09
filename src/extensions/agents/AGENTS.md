# Agents Extension

This extension owns built-in agent definitions, the agent registry, and the `kota agent` CLI surface.

- `index.ts` — built-in-agent registry wiring, `registerAgent`, `getAgent`, `listAgents`, and `kota agent list`/`inspect` commands. Built-in agent metadata is sourced from `src/workflows/builtin-agents.ts`.

The core loop looks up agents by name via `getAgent`. Extensions may contribute additional agents by calling `registerAgent` from their init hook. The registry is populated at module load time from `src/workflows/builtin-agents.ts` and can be overridden per agent via `config.agentModels`.
