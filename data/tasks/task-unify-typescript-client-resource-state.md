---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences]
---

# Unify TypeScript client resource state

## Scope / Starting Points

Inventory `clients/mobile/src`, `clients/web/src`, and shared client code for idle, loading, success, empty, offline, retry, cancellation, recoverable failure, and semantic-unavailable state across knowledge, memory, history, tasks, recall, answer, digest, attention, capture, and retract.

## Required Changes

- Introduce composable typed variants for common async-resource and search transitions.
- Share production state and shells where runtime/tooling permits; keep web/mobile platform adapters explicit.
- Migrate every inventoried screen or record a genuine domain/platform exception.
- Delete per-screen reducers, lifecycle fixtures, repeated state matrices, and test-only reset hooks.

## Must Not Complete While

Any screen is unclassified, common transitions remain reimplemented, or the replacement is a configuration object dominated by unrelated optional flags.

## Done When

All inventoried screens use the shared owner or document a unique exception; their suites cover only domain actions, rendering, navigation, accessibility, and platform semantics.

## Acceptance Evidence

Provide the screen/state/disposition matrix and before/after production, test, and support LOC.

## Initiative

Child of `task-unify-client-resource-state-and-search-shells`.
