---
id: task-module-config-extension-registry
title: Let modules register top-level config keys instead of maintaining a core allowlist
status: backlog
priority: p2
area: core
summary: Modules that introduce new top-level config keys must be manually added to KNOWN_CONFIG_KEYS in core. A registration hook would let modules declare their own keys and remove the coupling.
created_at: 2026-04-12T12:35:00Z
updated_at: 2026-04-12T12:35:00Z
---

## Problem

`src/core/config/config-warnings.ts` maintains a hardcoded `KNOWN_CONFIG_KEYS`
allowlist. Every time a module introduces a new top-level config surface (e.g.
`notifications`, `scheduler`, `webhooks`), the core file must be edited to
suppress the unknown-key warning. This couples modules to core for a purely
declarative concern.

## Desired Outcome

Modules can declare the top-level config keys they own during `onLoad`. The
config warning system consults the module-declared keys alongside any remaining
core keys. No core edit is required when a module adds a new config surface.

## Constraints

- The registration must happen during module load, before config warnings fire.
- Keep the warning system intact — unknown keys that no module claims should
  still warn.
- Do not change the config file format or break existing configs.
- The registration surface should be minimal: key name and optional one-line
  description.

## Done When

- Modules can call a registration function during `onLoad` to claim top-level
  config keys.
- `KNOWN_CONFIG_KEYS` is reduced to only core-owned keys.
- At least one existing module (e.g. `scheduler`, `webhook`) registers its key
  via the new mechanism.
- Config warnings still fire for genuinely unknown keys.
- Tests cover registration, duplicate-key rejection, and warning behavior.
