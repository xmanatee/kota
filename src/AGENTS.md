# Source Tree

`src/` has two layers:

- `src/core/` is the small runtime kernel: protocols, lifecycle, daemon,
  workflow execution, eventing, sessions, and shared contracts.
- `src/modules/` contains project-owned modules that contribute tools,
  workflows, agents, skills, channels, routes, commands, and services.

Root `src/*.ts` files should stay rare and act only as public entrypoints or
thin repo-wide glue.

Guidelines:

- Keep `src/core/` protocol-oriented.
- Put swappable features in modules.
- Avoid aliases, compatibility wrappers, and parallel surfaces between core and
  modules.
- Read the local `AGENTS.md` before changing a subtree.

## Root Layout

Keep public entrypoints and genuinely cross-subsystem integration scenarios at
the `src/` root. Unit tests and component fixtures belong beside their owning
core area or module. Cross-cutting fixtures are exceptional: prefer an owned
typed builder or semantic scenario over a root-level data catalog.

Core code and core-only tests do not import project modules. Scenarios that
assemble both layers belong at the integration boundary. Enforce these
boundaries with package structure and the smallest structural check that cannot
be expressed by TypeScript or module visibility; do not maintain filename
catalogs in instructions.

## Strict Types Policy

Production TypeScript stays strict. Decode untrusted boundary values into
precise domain types before use; test decoder rejection and propagation rather
than source syntax or per-file type-token counts. See `src/core/AGENTS.md`.
