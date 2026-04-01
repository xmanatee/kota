---
id: task-guardrail-audit-cli
title: Add kota audit CLI command to query the guardrail audit trail
status: backlog
priority: p3
area: cli
summary: The guardrail audit trail is accessible from the web UI and via GET /api/audit, but has no CLI surface. Operators running without the web server cannot query risk decisions from the shell.
created_at: 2026-04-01T00:32:00Z
updated_at: 2026-04-01T00:32:00Z
---

## Problem

`AuditStore` records every guardrail policy decision (tool call risk, policy
outcome, session ID, tool name) in a SQLite-backed store. The web UI exposes
this via `GET /api/audit`, but there is no `kota audit` CLI subcommand.

Operators who run the daemon without the web server, or who want to script
audit queries in CI or monitoring pipelines, have no shell-level access to
audit records.

## Desired Outcome

A `kota audit` command with at least:

- `kota audit list` — list recent audit entries (default: last 50), formatted
  as a table with columns: session, tool, risk, policy, timestamp.
- `--risk <level>` filter (low, medium, high, critical).
- `--policy <outcome>` filter (allowed, blocked, prompted).
- `-n <n>` limit flag.

On success, prints the table. Exits non-zero if the store cannot be read.

## Constraints

- Read from `AuditStore` directly (same as the web handler in `audit-routes.ts`).
- No new dependencies.
- Follow the existing pattern for CLI commands in `src/` (Commander-based).
- Register the command in `cli.ts` alongside other store commands.

## Done When

- `kota audit list` prints a formatted table of recent audit entries.
- `--risk` and `--policy` filters work correctly.
- A basic test covers the list path.
