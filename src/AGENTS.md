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

The `src/` root holds only:

- Entrypoint sources (`cli.ts`, `init.ts`, `module-api.ts`,
  `validate-queue.ts`) and their paired unit tests (`cli.test.ts`,
  `init.test.ts`).
- Cross-subsystem integration, e2e, and repo-wide tests:
  `*.integration.test.ts`, `e2e*.test.ts`, `integration.test.ts`,
  `module-e2e.test.ts`, `distributable-surfaces.test.ts`,
  `docs-surface.test.ts`, `task-files.test.ts`.
- Shared fixtures co-located with cross-cutting integration tests when
  they span multiple subsystems and have no single owning module
  (e.g. `conversational-cross-store-fixture.integration.ts`). The fixture name must
  also be added to the `CROSS_CUTTING_FIXTURES` whitelist in
  `src/root-layout.test.ts`.
- `root-layout.test.ts`, the whitelist guard itself.

Every other unit test lives next to the code it exercises under
`src/core/<area>/` or `src/modules/<module>/`. `src/root-layout.test.ts`
enforces this mechanically: adding a new non-whitelisted `src/*.test.ts`
fails the guard. If a test legitimately spans multiple subsystems, rename
it to `*.integration.test.ts`; otherwise move it to the owning subsystem.

Core tests may not use `#modules/*` imports (`src/core/agent-harness/no-module-imports-in-core.test.ts`
enforces this). A test that genuinely needs to load or reference project
modules therefore belongs at the root integration tier, not under `src/core/`.
