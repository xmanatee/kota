---
id: task-centralize-approval-and-owner-decision-state
title: Centralize approval and owner decision state
status: backlog
priority: p1
area: decisions
summary: Create small durable approval and owner-decision state owners so workflows, routes, CLI, channels, and MCP become thin adapters instead of rebuilding lifecycle fixtures.
task_class: Safety
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Approval and owner-decision tests repeatedly construct workflows, stores, runs, clocks, routes, MCP execution, Telegram or Slack delivery, and recovery state to exercise one transition. The concentration signals that enqueue, review, expiry, authorization, execution receipt, digest, resume, and recovery do not have sufficiently small production owners.

## Desired Outcome

A durable approval service or state machine owns approval transitions and execution receipts, and a durable owner-decision service owns choices and resume authorization. External surfaces map identities and messages to those owners without reimplementing lifecycle semantics.

## Constraints

- Preserve authorization, revision binding, expiry, replay resistance, destructive-action confirmation, recovery, and audit provenance.
- Separate decision semantics from persistence, delivery, rendering, and workflow orchestration through narrow ports.
- Avoid ambient singletons, broad aggregate contexts, reset APIs, and backward-compatible shadow stores.
- Use model or property observations for transition invariants only where they catch distinct state-machine defects.

## How We Will Know

- Transition behavior is observable through small public owners without booting a workflow host or channel stack.
- Each route, CLI, channel, and MCP adapter has at most its distinct identity, parsing, rendering, or wire mapping proof.
- Security-sensitive replay, expiry, authorization, persistence, and recovery guarantees remain explicit.
- The affected suites show a material net reduction within the non-additive 12k-18k opportunity band and reset-style setup declines.
