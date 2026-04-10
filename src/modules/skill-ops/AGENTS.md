# Skill Ops Module

This module owns the reflective `kota skill` CLI surface and the operator path
for importing standalone skill files into `.kota/skills/`.

- `index.ts` — `kota skill list` and `kota skill import`.
- Module-owned skill markdown should live with the module that provides the
  capability, not here.
- Keep this module focused on inspection and import mechanics, not on owning a
  shared bucket of unrelated skill content.
