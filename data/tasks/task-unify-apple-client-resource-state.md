---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences]
---

# Unify Apple client resource state

## Scope / Starting Points

Inventory `clients/apple/Sources` and `clients/apple/Tests` for repeated loading, result, empty, offline, retry, cancellation, failure, and semantic-unavailable state and screen setup.

## Required Changes

- Introduce one Swift-native typed resource state owner and composable presentation shell.
- Migrate every inventoried Apple resource screen or record a genuine native exception.
- Preserve accessibility, navigation, cancellation, offline, retry, and owner-visible rendering.
- Delete duplicated view models/reducers, lifecycle fixtures, reset hooks, and repeated transition matrices.

## Must Not Complete While

Any screen is unclassified, shared transitions remain copied, or TypeScript abstractions leak across the language boundary.

## Done When

Every Apple resource screen uses the Swift owner or has a documented unique exception and retained checks cover only Apple/domain behavior.

## Acceptance Evidence

Provide the Apple screen/state/disposition matrix and before/after production, test, and support LOC.

## Initiative

Child of `task-unify-client-resource-state-and-search-shells`.
