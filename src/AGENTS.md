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
