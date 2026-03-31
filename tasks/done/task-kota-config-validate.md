---
id: task-kota-config-validate
title: Add kota config validate command for config introspection
summary: Add a CLI command to validate and inspect the merged kota config, warning about unknown keys.
status: done
priority: p3
area: cli
created_at: 2026-03-31T03:00:00Z
updated_at: 2026-03-31T04:25:00Z
---

## Problem

Operators edit `.kota/config.json` by hand with no feedback mechanism. Unknown keys are silently ignored by `parseConfig`, so typos in field names (e.g. `modelTier` instead of `modelTiers`) fail silently — operators have no way to verify the config they wrote is being applied.

There is no command to inspect the merged, resolved config in effect at runtime (global + project layers merged).

## Desired Outcome

- `kota config validate` reads and merges all config layers, prints the resolved config as JSON, and exits 0 on success
- Warns (to stderr) about any top-level keys present in the raw file that are not recognized by `parseConfig` (unknown keys)
- `kota config validate --json` outputs only the resolved config JSON for scripting
- Output includes the source file paths contributing to each layer

## Constraints

- Read-only; no mutation of config files
- Unknown-key detection uses the known keys from `parseConfig` — no need for a separate schema file
- Only top-level keys are checked; nested unknown keys are out of scope
- Command registered in main CLI (`src/cli.ts`) alongside existing subcommands

## Done When

- `kota config validate` prints resolved merged config and reports unknown top-level keys
- `--json` flag outputs raw JSON only
- Source file paths shown in normal output
- Manual test: introduce a typo in `.kota/config.json`; `kota config validate` warns about the unknown key
