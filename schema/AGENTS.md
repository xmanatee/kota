# Schema

This directory contains published JSON Schema files for KOTA data structures.

- `kota-config.schema.json` — Draft-7 schema for `KotaConfig` (`.kota/config.json`). Generated from the source type by `pnpm build:schema`; do not hand-edit. Referenced by `kota config schema` (prints path) and `kota config schema --print` (outputs content). Wire it into VS Code via `.vscode/settings.json` `json.schemas` to get IDE validation and autocompletion.

## Adding a schema

- Use JSON Schema Draft-7 (`"$schema": "http://json-schema.org/draft-07/schema#"`).
- Name the file after the structure it validates (e.g. `kota-config.schema.json`).
- If the schema is referenced from CLI or runtime code, keep the path stable — `config-cli.ts` imports it via `../schema/<name>` relative to `dist/`.
- Document the new schema file in `docs/` and update this file.
