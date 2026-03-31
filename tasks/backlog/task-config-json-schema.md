---
id: task-config-json-schema
title: Publish JSON Schema for kota.config to enable IDE validation and autocompletion
status: backlog
priority: p3
area: cli
summary: kota.config.json has no published JSON Schema, so operators get no IDE autocompletion or validation feedback when editing the config file. A schema would catch typos and surface available options without reading docs.
created_at: 2026-03-31T16:34:49Z
updated_at: 2026-03-31T16:34:49Z
---

## Problem

KOTA's config format is documented in `docs/CONFIG.md` but has no machine-readable schema.
Operators editing `.kota/config.json` get no IDE hints, no validation of unknown keys, and no
documentation-on-hover. As the config grows (log format, daemon settings, extension configs,
budget guard, model overrides) the risk of silent misconfiguration grows.

`kota config validate` already parses and reports unknown top-level keys, but it requires
running a CLI command and does not help during editing.

## Desired Outcome

A `kota-config.schema.json` published alongside the package (e.g., in `dist/` or a top-level
`schema/` directory). The schema covers all documented top-level keys, their types, and valid
values with descriptions.

A `kota config schema` subcommand prints the schema path (or its content) so operators can
add it to their workspace JSON Schema mappings:

```json
// .vscode/settings.json
{ "json.schemas": [{ "fileMatch": [".kota/config.json"], "url": "./schema/kota-config.schema.json" }] }
```

## Constraints

- Schema is generated or hand-authored from the existing TypeScript config types; both approaches
  are acceptable as long as the schema stays in sync.
- If auto-generated (e.g., via `ts-json-schema-generator`), add a `package.json` script to
  regenerate it so it doesn't drift.
- Schema must be valid JSON Schema Draft 7 or later.
- Do not require a net-new dev dependency if `ts-json-schema-generator` or equivalent is already
  available in the repo.

## Done When

- `schema/kota-config.schema.json` (or equivalent path) exists and validates a sample config.
- `kota config schema` prints the schema file path.
- The schema includes descriptions for all documented keys.
- IDE validation works when the schema is wired to `.kota/config.json` via VS Code settings.
- Existing tests pass.
