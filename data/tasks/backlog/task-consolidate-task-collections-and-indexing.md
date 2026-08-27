---
id: task-consolidate-task-collections-and-indexing
title: Consolidate task collections and semantic indexing
status: backlog
priority: p1
area: modules
summary: Track bounded collection-semantics and semantic-index lifecycle ownership migrations.
task_class: Platform
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

Collection behavior and semantic-index lifecycle each have one production owner. Implementations declare only supported capabilities, and adapter verification covers only added semantics.

## Tracked Slices

- [ ] task-consolidate-repo-task-collection-semantics
- [ ] task-centralize-semantic-index-lifecycle

## Done When

Both slices are complete, their inventories have no unresolved rows, and no universal optional base class, compatibility provider shape, duplicate cache, or reset hook remains.

## Initiative

Lean behavioral verification: make conformance structural and capability-selected.
