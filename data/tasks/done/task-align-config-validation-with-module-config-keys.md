---
id: task-align-config-validation-with-module-config-keys
title: Align config validation with module-owned config keys
status: done
priority: p1
area: config
summary: Modules can register top-level config keys, but the config CLI still validates against only the static core key set.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T14:05:59.747Z
---

## Problem

Modules can declare top-level `configKeys`, and the loader collects keys such as
`scheduler`, `webhooks`, and `mcp`. The daemon/web path can pass those keys into
unknown-key warnings, but the `kota config` CLI still imports only
`KNOWN_CONFIG_KEYS`. This means module-owned config can be treated as unknown by
one operator surface even though it is valid elsewhere.

There is also a loose `moduleMonitoring` config field referenced by daemon code
but not consistently represented in parsing, docs, schema, and validation.

## Desired Outcome

Config validation has one clear ownership model: core keys come from the core
schema, module keys come from loaded module declarations, and every accepted
runtime key is parsed, merged, documented, and schema-backed. Incomplete or dead
config fields are removed rather than silently accepted.

## Constraints

- Do not move module-owned keys into the static core allowlist.
- Do not add a second config validator.
- Do not keep `moduleMonitoring` unless it is fully wired through parsing,
  merging, schema, docs, and tests.
- Keep command-only module loading safe and deterministic for config CLI use.

## Done When

- `kota config validate` and `kota config set` recognize loaded module config keys.
- `scheduler`, `webhooks`, and `mcp` are not warned as unknown by the config CLI.
- `moduleMonitoring` is either fully implemented across all config surfaces or removed from code.
- Tests cover module-owned config keys through the actual config command path.
