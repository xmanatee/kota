# Agents Extension

This extension owns built-in agent definitions, the agent registry, and the `kota agent` CLI surface.

- `index.ts` — `BUILTIN_AGENTS` array (`inbox-sorter`, `explorer`, `builder`, `improver`), `registerAgent`, `getAgent`, `listAgents`, and `kota agent list`/`inspect` commands.

The core loop looks up agents by name via `getAgent`. Extensions may contribute additional agents by calling `registerAgent` from their init hook. The registry is populated at module load time from `BUILTIN_AGENTS` and can be overridden per agent via `config.agentModels`.
