---
id: task-unify-apple-client-resource-state
title: Unify Apple client resource state
status: backlog
priority: p1
area: clients-apple
summary: Give the Swift client one typed resource/search lifecycle owner while preserving native navigation and accessibility behavior.
task_class: Product
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
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
