---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences]
---

# Consolidate repository task collection semantics

## Scope / Starting Points

Inventory `src/modules/repo-tasks`, remote task providers, provider caches, and every list/get/active/count/empty/summary implementation and test.

## Required Changes

- Define one normalized collection representation and query owner.
- Keep provider adapters limited to decoding, identity, persistence mapping, and capabilities they actually support.
- Replace universal optional methods with small declared capabilities and capability-selected conformance.
- Delete copied caches, wrapper forwarding methods, reset hooks, legacy provider shapes, and mirrored query tests.

## Must Not Complete While

Any inventory row is unresolved, any provider reimplements a shared query, or conformance invokes a capability the provider does not declare.

## Done When

All providers use the owner, each retained adapter scenario names added behavior, and private collection refactors do not change vendor suites.

## Acceptance Evidence

Provide the provider/capability/disposition matrix and before/after production, test, and support LOC for this scope.

## Initiative

Child of `task-consolidate-task-collections-and-indexing`.
