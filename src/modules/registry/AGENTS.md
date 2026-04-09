# Registry Extension

This directory owns the `registry` built-in extension — external tool package management.

- Registers `kota tools` CLI command with `install`, `remove`, `update`, and `list` subcommands.
- Actual registry logic lives in `src/registry.ts`.

## Files

- `index.ts` — `KotaExtension` definition; `kota tools` CLI command.
- `index.test.ts` — unit tests for registry command registration.
