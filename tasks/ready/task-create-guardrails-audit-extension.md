---
id: task-create-guardrails-audit-extension
title: Create dedicated guardrails-audit extension to own audit trail and CLI
status: ready
priority: p2
area: architecture
summary: The audit trail is core logic in guardrails-audit.ts and audit-cli.ts. Creating a dedicated extension would consolidate ownership and allow the audit subsystem to be optionally disabled or extended without core changes.
created_at: 2026-04-09T06:33:00Z
updated_at: 2026-04-09T06:33:00Z
---

## Problem

The guardrails audit trail is a security-critical subsystem that logs all guardrail assessments.
It lives split between core files (`guardrails-audit.ts` for implementation, `audit-cli.ts` for
operator CLI). This creates core-level complexity when the audit trail could be treated as an
optional observer that subscribes to guardrail events.

## Desired Outcome

A new `src/extensions/guardrails-audit/` extension that:

- Owns the persistent JSONL audit log and query helpers
- Owns `registerAuditCommands` and all `kota audit` subcommands
- Subscribes to guardrail assessment events from the core via the event bus
- Can be disabled or replaced via config without touching core guardrails logic
- Follows the same lifecycle pattern as event-subscribed extensions like slack/telegram

The core guardrails assessment logic remains in `guardrails.ts` and emits assessment events
to the bus. The audit extension subscribes and logs. This decouples the core policy engine
from its audit trail.

## Constraints

- Audit trail format and query APIs must remain stable.
- All existing audit workflows and queries must work unchanged.
- The extension should not break if disabled; audit just won't be logged.

## Done When

- `src/extensions/guardrails-audit/` exists with full implementation.
- `guardrails-audit.ts` is removed or minimal.
- `audit-cli.ts` is removed from src/.
- Core guardrails emit assessment events to the bus.
- Audit extension subscribes and logs assessments to `.kota/audit.jsonl`.
- `kota audit` commands work unchanged.
- All guardrails-audit tests pass.

