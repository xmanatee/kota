# Extension Manager Extension

This extension contributes the `kota extension` CLI surface: `list`, `inspect`, and `new`.

- `kota extension list` — show all loaded extensions with contribution counts.
- `kota extension inspect <name>` — show full detail for one extension.
- `kota extension new <name>` — scaffold a new TypeScript or Python extension.

## Boundaries

- Uses `ctx.getExtensionSummaries()` for live extension data; no independent loader.
- Scaffold generators live in `scaffolds.ts` to keep `index.ts` focused.
- Avoid importing the built-in extension discovery entrypoint from here; this command should inspect loaded state, not rebuild it.
