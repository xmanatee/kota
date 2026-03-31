# Agents

This directory contains the canonical registry of KOTA's built-in agent definitions.

- `index.ts` is the single source of truth for built-in agent names, roles, models, tool permissions, and write scopes.
- Extensions can contribute additional agents via `KotaExtension.agents`; those are registered here at load time.
- Do not duplicate agent configuration between this registry and workflow definitions. Workflows reference agents by name; the definition lives here.
