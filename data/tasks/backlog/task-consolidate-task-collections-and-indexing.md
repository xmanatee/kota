---
id: task-consolidate-task-collections-and-indexing
title: Consolidate task collections and semantic indexing
status: backlog
priority: p1
area: modules
summary: Move repeated task collection queries and semantic index lifecycle into shared production owners, with conformance applied only to capabilities an implementation declares.
task_class: Platform
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Remote task providers repeat list, active, get, summary, emptiness, and count behavior over similar caches. History, memory, and knowledge semantic wrappers repeat ranking, indexing, staleness, reindex, error, and deletion behavior already implied by SemanticIndexManager. Each implementation then carries a near-universal test checklist, including operations it does not support.

## Desired Outcome

A normalized task collection owns common collection semantics and SemanticIndexManager owns index lifecycle. Vendor and store adapters declare supported capabilities and retain only identity, decoding, persistence mapping, and other semantics they add. Shared conformance checkers select only contracts declared by each implementation.

## Constraints

- Do not create a universal base class whose optional methods and flags recreate the same complexity.
- Prefer small capability declarations, composition, and explicit ports over inheritance and compatibility aliases.
- Conformance checks must be parameterized by declared capabilities and consumer-visible guarantees, not private method catalogs.
- Remove wrapper forwarding tests, duplicated caches, reset hooks, and legacy provider shapes when ownership moves.

## How We Will Know

- Collection and semantic-index invariants are proved once at their production owners.
- An adapter with no mutation or reindex capability is not tested against that contract.
- Vendor and store suites change only when their declared behavior changes, not when shared algorithms are refactored.
- The affected families show a material net reduction within the investigation's non-additive 8k-15k opportunity band.
