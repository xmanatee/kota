---
status: done
---

# Centralize approval lifecycle state

## Scope / Starting Points

Inventory `src/modules/approval-queue` plus approval behavior in workflow, route, CLI, MCP, Telegram, Slack, recovery, and digest paths: enqueue, review, authorize, reject, expire, execute, receipt, replay, and recovery.

## Required Changes

- Extract a small public transition owner and durable persistence/clock ports inside `approval-queue`.
- Preserve identity authorization, revision binding, expiry, replay resistance, destructive-action confirmation, receipts, audit provenance, and recovery.
- Make external surfaces map identities, messages, and wire values without reimplementing transitions.
- Delete shadow stores, lifecycle copies, ambient resets, compatibility paths, and large workflow/channel fixtures used only to exercise one transition.

## Must Not Complete While

Any transition has multiple owners, any adapter decides authorization or lifecycle state, or any inventory row is unresolved.

## Done When

All transitions are observable through the owner; adapters retain only unique identity, parsing, rendering, delivery, or wire behavior.

## Acceptance Evidence

Provide the transition/owner/adapter/disposition matrix and evidence for authorization, expiry, replay, persistence, receipt, and recovery outcomes.

## Initiative

Child of `task-centralize-approval-and-owner-decision-state`.
