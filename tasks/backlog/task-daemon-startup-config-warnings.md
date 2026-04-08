---
id: task-daemon-startup-config-warnings
title: Log unknown config key warnings at daemon startup
status: backlog
priority: p3
area: runtime
summary: The daemon loads and sanitizes config at startup but silently discards unknown keys. Logging a warning when unrecognized top-level config keys are detected helps operators catch typos or stale field names early without running kota config validate manually.
created_at: 2026-04-08T16:17:29Z
updated_at: 2026-04-08T16:17:29Z
---

## Problem

`kota config validate` checks for unknown top-level keys in config files and prints
warnings, but this check is only run when operators explicitly invoke the command.
The daemon itself calls `loadConfig` at startup and silently applies `sanitize()`,
which drops any key not in `KotaConfig`. A typo like `dailyBugetUsd` or a stale
field name from an older KOTA version is accepted without comment, causing the
operator's intended config to be silently ignored.

The validation logic already exists in `src/config-cli.ts` (`KNOWN_CONFIG_KEYS` set
and `readRawKeys` helper). The daemon just never invokes it.

## Desired Outcome

At daemon startup (and at `kota serve` startup when no daemon is running), after
`loadConfig` completes, a lightweight key-check runs against the raw project config
file. Any top-level keys not in `KNOWN_CONFIG_KEYS` are logged as warnings via the
daemon logger. The warnings are visible in `kota daemon logs` and written to the
daemon log file.

The check should be a separate utility function (e.g., `warnUnknownConfigKeys`) that
both the daemon startup path and `kota config validate` can call, avoiding duplication.

## Constraints

- Warnings are non-fatal; startup proceeds normally.
- Only top-level keys are checked (nested-key validation is optional follow-up work).
- The check runs against the raw project config file on disk, not the merged resolved
  config, so field names lost during merge are still visible.
- No new CLI commands or config fields required.
- The shared utility must be importable without pulling in the full CLI program.

## Done When

- Starting the daemon with a config file containing an unknown top-level key logs a
  warning in the daemon output and daemon log file.
- `kota config validate` still works as before and uses the same underlying utility.
- Existing startup and config tests continue to pass; a unit test covers the warning
  path.
