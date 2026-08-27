---
id: task-prune-web-mobile-apple-test-duplication
title: Prune web, mobile, and Apple test duplication
status: backlog
priority: p1
area: clients
summary: Keep first-party client suites focused on platform interaction and domain rendering after shared state and transport ownership land.
task_class: Product
depends_on: [task-generate-daemon-client-transport-bindings, task-unify-typescript-client-resource-state, task-unify-apple-client-resource-state, task-centralize-approval-lifecycle-state, task-centralize-owner-decision-lifecycle-state]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `clients/web`, `clients/mobile`, and `clients/apple` suites for domain matrices, resource lifecycle, routing, accessibility, navigation, rendering, trust, confirmation, transport, fixtures, and snapshots.

## Required Changes

- Retain only platform navigation, accessibility, interaction, trust, confirmation, domain-specific rendering, and genuine transport boundary behavior.
- Delete domain lifecycle copies, shared-state matrices, incidental snapshots, and exhaustive local/daemon or screen permutations.
- Keep a bounded set of real client journeys, each tied to a distinct composition failure.

## Must Not Complete While

Any screen/scenario is unclassified, shared owner behavior remains repeated, or a journey uses internal mocks that eliminate the boundary it claims to prove.

## Done When

The inventory has zero unresolved rows and every retained scenario names a web, mobile, Apple, accessibility, navigation, rendering, or trust failure unique to that surface.

## Acceptance Evidence

Provide the surface/scenario/disposition matrix and before/after executable-test and authored-support LOC per client runtime.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.
