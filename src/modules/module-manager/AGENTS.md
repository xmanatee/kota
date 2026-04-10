# Module Manager Module

This module contributes the `kota module` CLI surface: `list`, `inspect`, and `new`.

- `kota module list` — show all loaded modules with contribution counts.
- `kota module inspect <name>` — show full detail for one module.
- `kota module new <name>` — scaffold a new TypeScript or Python module.

## Boundaries

- Uses `ctx.getModuleSummaries()` for live module data; no independent loader.
- Contributes an HTTP route for listing modules.
- Avoid importing the repo module discovery entrypoint from here; this command should inspect loaded state, not rebuild it.
