# Registry Module

This directory owns the `registry` repo module — external tool package management.

- Registers `kota tools` CLI command with `install`, `remove`, `update`, and `list` subcommands.
- Actual registry logic lives in `src/registry.ts`.

## Files

- `index.ts` — `KotaModule` definition; `kota tools` CLI command.
- `index.test.ts` — unit tests for registry command registration.
