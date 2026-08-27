---
id: task-prune-capture-retract-write-adapters
title: Consolidate capture, retract, and write adapters
status: backlog
priority: p1
area: data-capabilities
summary: Remove duplicated validation, propagation, persistence, and result behavior from write-oriented capability surfaces.
task_class: Safety
depends_on: [task-generate-daemon-client-transport-bindings]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `src/modules/capture`, `retract`, affected stores, routes, local/daemon clients, CLI/tools/channels, provenance, authorization, atomicity, fixtures, and tests.

## Required Changes

- Name one owner for write validation, identity, authorization, atomic persistence, provenance, retraction targeting, not-found, and durable outcome.
- Use generated routine transport and direct domain result types.
- Retain adapters only for wire decoding, trust mapping, confirmation, rendering, or provider-specific persistence transforms.
- Delete forwarding wrappers, copied result arms, compatibility paths, reset hooks, and implementation-shaped fixtures.

## Must Not Complete While

Any behavior or file is unclassified, destructive semantics exist above the owner, or deleted tests are displaced into support code.

## Done When

The inventory has zero unresolved rows and authorization, atomicity, provenance, idempotency, retraction correctness, and recovery remain explicit at their owners.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
