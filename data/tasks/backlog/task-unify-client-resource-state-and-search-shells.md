---
id: task-unify-client-resource-state-and-search-shells
title: Unify client resource state and search shells
status: backlog
priority: p1
area: clients
summary: Track separate TypeScript and Apple resource-state ownership migrations without imposing a false cross-language abstraction.
task_class: Product
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

Each client runtime has one typed owner for repeated loading, result, empty, offline, retry, cancellation, failure, and semantic-unavailable transitions. Screens retain only domain and platform behavior.

## Tracked Slices

- [ ] task-unify-typescript-client-resource-state
- [ ] task-unify-apple-client-resource-state

## Done When

Both runtime slices are complete and every current resource screen has an explicit migrated or exceptional disposition.

## Initiative

Lean behavioral verification: remove repeated production state before deleting repeated screen tests.
