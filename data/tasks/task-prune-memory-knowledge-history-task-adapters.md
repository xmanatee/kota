---
status: open
priority: p1
depends_on: [task-generate-daemon-client-transport-bindings, task-consolidate-repo-task-collection-semantics, task-centralize-semantic-index-lifecycle]
---

# Consolidate memory, knowledge, history, and task adapters

## Scope / Starting Points

Inventory `memory`, `knowledge`, `history`, `repo-tasks`, their semantic modules, routes, local/daemon clients, CLI consumers, result unions, caches, fixtures, and tests.

## Required Changes

- Assign validation, not-found, empty, semantic-unavailable, ranking, persistence, provenance, and retraction behavior to one named owner each.
- Consume generated transport, normalized collections, and `SemanticIndexManager` rather than forwarding wrappers.
- Retain adapter checks only for decoding, persistence mapping, identity, citation/provenance, and genuine transforms.
- Delete local/daemon mirrors, copied result arms, provider resets, compatibility paths, and implementation-shaped fixtures.

## Must Not Complete While

Any behavior or file is unclassified, any routine mapping remains handwritten, or deleted test LOC has moved into helpers/fixtures.

## Done When

The inventory has zero unresolved rows, each behavior has one owner and strongest observation, and one vertical journey covers only remaining composition risk.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
