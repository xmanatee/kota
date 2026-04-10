# Module Manager Module

This module contributes the `kota module` CLI surface: `list`, `inspect`, and `new`.

- `kota module list` — show all loaded modules with contribution counts.
- `kota module inspect <name>` — show full detail for one module.
- `kota module new <name>` — scaffold a new TypeScript or Python module.

## Boundaries

- Uses `ctx.getModuleSummaries()` for live module data; no independent loader.
- Scaffold generators live in `scaffolds.ts` to keep `index.ts` focused.
- `routes.ts` — `handleListModules` route handler contributed as `GET /api/modules` via `KotaModule.routes`.
- Avoid importing the repo module discovery entrypoint from here; this command should inspect loaded state, not rebuild it.
