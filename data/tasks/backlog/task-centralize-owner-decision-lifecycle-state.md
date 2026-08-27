---
id: task-centralize-owner-decision-lifecycle-state
title: Centralize owner-decision lifecycle state
status: backlog
priority: p1
area: owner-decisions
summary: Make owner-decisions the sole durable owner of choices, revision binding, and workflow resume authorization.
task_class: Safety
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `src/modules/owner-decisions`, owner questions, workflow waiting/resume, route, CLI, MCP, Telegram, Slack, digest, expiry, and recovery behavior.

## Required Changes

- Extract one public decision transition owner with narrow durable persistence, clock, and resume-authority ports.
- Preserve identity, allowed choices, revision binding, expiry, replay resistance, provenance, recovery, and exactly-once resume authorization.
- Make all surfaces thin identity, parsing, rendering, delivery, or wire adapters.
- Delete shadow stores, copied resume logic, ambient resets, compatibility paths, and lifecycle fixtures outside the owner.

## Must Not Complete While

Any surface can independently decide lifecycle or resume authority, any transition has multiple stores, or any inventory row is unresolved.

## Done When

All owner-choice and resume transitions are observable through the owner and adapters retain only behavior they add.

## Acceptance Evidence

Provide the transition/owner/adapter/disposition matrix and evidence for revision, expiry, replay, persistence, recovery, and exactly-once resume outcomes.

## Initiative

Child of `task-centralize-approval-and-owner-decision-state`.
