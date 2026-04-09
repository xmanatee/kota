---
id: task-create-guardrails-audit-extension
title: Complete guardrails-audit extension to own audit state (CLI already migrated)
status: ready
priority: p2
area: architecture
summary: src/extensions/guardrails-audit/ exists with CLI commands. The remaining work is migrating audit state from src/guardrails-audit.ts into the extension and wiring it to emit/subscribe on the event bus so the audit trail can be optionally disabled without core changes.
created_at: 2026-04-09T06:33:00Z
updated_at: 2026-04-09T05:45:00Z
---

## Problem

`src/guardrails-audit.ts` still owns the audit log appender and query helpers in core, even though the CLI commands have already moved to `src/extensions/guardrails-audit/`. Core `guardrails.ts` calls the audit module directly, making it impossible to disable or swap the audit backend without touching core. Audit state should be fully owned by the extension.

## Current State

`src/extensions/guardrails-audit/` exists with `cli.ts` (all `kota audit` subcommands) and
`index.ts` (extension module). `audit-cli.ts` has been removed from `src/`. The CLI half of
the migration is complete.

The remaining gap: `src/guardrails-audit.ts` (audit log appender, query helpers, AuditEntry type)
still lives in core. Guardrails assessment logic in `guardrails.ts` calls it directly.

## Desired Outcome

Complete the extension so it fully owns the audit subsystem:

- Move audit log storage, `appendAuditEntry`, `queryAuditLog`, and `AuditEntry` into the extension
- Core `guardrails.ts` emits assessment events to the event bus instead of calling the audit module directly
- The extension subscribes to those events and writes to `.kota/audit.jsonl`
- The extension can be disabled via config without touching core guardrails logic

The core guardrails assessment logic remains in `guardrails.ts`; only the logging output moves to the extension.
No behavior change; this is a refactoring + decoupling.

## Constraints

- Audit trail format and query APIs must remain stable.
- All existing audit workflows and queries must work unchanged.
- The extension should not break if disabled; audit just won't be logged.

## Done When

- `src/guardrails-audit.ts` is removed or reduced to a minimal type re-export.
- `src/extensions/guardrails-audit/` has full state + CLI implementation.
- Core guardrails emit assessment events to the bus.
- Audit extension subscribes and logs assessments to `.kota/audit.jsonl`.
- `kota audit` commands work unchanged.
- All guardrails-audit tests pass.

