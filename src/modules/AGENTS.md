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
- When adding or modifying a notification channel module (Telegram, webhook,
  Slack, email, or any future transport), update `docs/NOTIFICATIONS.md` to
  document the operator config. That file is the canonical reference for how
  operators wire up notification delivery.
