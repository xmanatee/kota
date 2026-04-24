# Modules

This directory contains the project-owned modules.

- Treat a module as the ownership boundary for tools, workflows, channels,
  skills, agents, routes, and related helpers.
- Add new module code as `<name>/index.ts` with its local helpers, prompts,
  tests, and docs kept under the same directory.
- Do not create parallel registries for workflows, agents, or channels outside
  the module system. If something is module-owned, discover it from the
  module itself.
- Keep top-level files here rare. This directory should mostly contain actual
  modules, not shared runtime helpers or discovery glue.
- Do not keep placeholder or wrapper modules after their shared runtime logic
  has moved into `src/core/`. If a module no longer owns behavior, remove it.
- If a module imports from another module at runtime (`#modules/X/...`), declare
  that module in the `dependencies` array of the KotaModule definition. The
  loader uses declared dependencies for load ordering and unload safety.
  Type-only imports (`import type`) do not need a declared dependency.
  `src/core/modules/module-deps.test.ts` enforces this.
- When adding or modifying a notification channel module, keep the module's
  local `AGENTS.md`, config type, and focused tests aligned. Exact event names,
  payload fields, and subscription lists belong in code and tests, not a shared
  docs catalog.

## Workflow contribution precedence

Workflows are contributed by modules through `KotaModule.workflows`. The loader
handles two contribution sources through a single path: modules KOTA ships in
`src/modules/*` (`moduleSource: "project"`) and modules the target project
ships under `<projectDir>/.kota/modules/*` (`moduleSource: "installed"`).
Project-local modules inherit `moduleRoot = projectDir` by default, so their
prompt paths resolve against the project tree; KOTA-shipped modules set their
own `moduleRoot` to their install root so shipped prompts keep resolving
inside KOTA's tree even when the daemon is pointed at an external project.
Workflow names must be globally unique across every contributing module
regardless of source — a collision is a load-time `WorkflowDefinitionError`
that names both contributions. Project-local workflows therefore cannot
silently override KOTA-shipped ones; renaming is the single escape hatch.
