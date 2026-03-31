---
id: task-config-get-set-cli
title: Add kota config get and kota config set subcommands
status: backlog
priority: p3
area: operator-ux
summary: kota config validate prints the full merged config but offers no targeted read/write API. Operators scripting KOTA in CI or shell workflows must either parse the JSON output or edit config files directly.
created_at: 2026-03-31T22:36:31Z
updated_at: 2026-03-31T22:36:31Z
---

## Problem

`kota config validate` dumps the full resolved config as JSON. When scripting (e.g. reading
the current model in a CI pipeline, toggling `skipConfirmations`, updating `dailyBudgetUsd`),
operators must either pipe through `jq` or edit JSON manually. There is no first-class
`get`/`set` interface.

## Desired Outcome

Two new subcommands under `kota config`:

- `kota config get <key>` — prints the value of `key` from the resolved (merged) config to
  stdout. Supports dot-notation for nested paths (e.g. `daemon.shutdownGracePeriodMs`).
  Exits non-zero if the key does not exist.

- `kota config set <key> <value>` — writes `key = value` into the **project-level** config
  (`$CWD/.kota/config.json`). Creates the file if it does not exist. Parses `value` as JSON
  when valid JSON, otherwise stores as a string. Does not touch global config.

Both commands stay consistent with the existing `loadConfig` / `KNOWN_CONFIG_KEYS` machinery
in `config-cli.ts`.

## Constraints

- `get` reads from the merged (resolved) config, not a single source file.
- `set` writes only to the project-level config file.
- Warn (but do not error) when setting an unrecognised key.
- `set` must handle nested keys via dot-notation (at least one level deep).
- Do not pull in a full config-manipulation library; direct JSON read/write is fine.
- No new top-level commands — these are subcommands of `kota config`.

## Done When

- `kota config get model` prints the current model string.
- `kota config set dailyBudgetUsd 5` writes `{"dailyBudgetUsd": 5}` into `.kota/config.json`.
- `kota config get daemon.shutdownGracePeriodMs` works for one level of nesting.
- Both commands have unit tests covering the basic read/write paths.
