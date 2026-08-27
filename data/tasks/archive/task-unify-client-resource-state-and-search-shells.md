---
status: dropped
---

# Unify client resource state and search shells

## Outcome

Each client runtime has one typed owner for repeated loading, result, empty, offline, retry, cancellation, failure, and semantic-unavailable transitions. Screens retain only domain and platform behavior.

## Tracked Slices

- [ ] task-unify-typescript-client-resource-state
- [ ] task-unify-apple-client-resource-state

## Done When

Both runtime slices are complete and every current resource screen has an explicit migrated or exceptional disposition.

## Initiative

Lean behavioral verification: remove repeated production state before deleting repeated screen tests.

## Disposition

This strategic tracking record is retired because initiatives are not executable tasks. Its child tasks retain the actionable outcomes and dependency structure.
