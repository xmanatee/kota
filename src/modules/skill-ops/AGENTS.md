# Skill Ops Module

This module owns the reflective `kota skill` CLI surface, the operator
path for importing standalone skill files into `.kota/skills/`, and the
`skills` `KotaClient` namespace.

- `index.ts` — `kota skill list` and `kota skill import` plus the top-level
  `localClient(ctx)` factory and `controlRoutes` for the daemon-control
  surface.
- `skill-ops-operations.ts` — shared `listSkills` / `importSkill` helpers
  that both the local handler and the daemon-control routes call through,
  so the two transports cannot diverge on skill shape.
- Module-owned skill markdown should live with the module that provides the
  capability, not here.
- Keep this module focused on inspection and import mechanics, not on owning a
  shared bucket of unrelated skill content. CLI action handlers consume
  `ctx.client.skills.<method>()` and never read `.kota/skills/` directly.
