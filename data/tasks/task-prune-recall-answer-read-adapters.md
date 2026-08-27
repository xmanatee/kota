---
status: open
priority: p1
depends_on: [task-generate-daemon-client-transport-bindings, task-centralize-semantic-index-lifecycle]
---

# Consolidate recall, answer, and read adapters

## Scope / Starting Points

Inventory `src/modules/recall`, `answer`, relevant document/read providers, routes, local/daemon clients, CLI/tool consumers, citations, semantic-unavailable handling, fixtures, and tests.

## Required Changes

- Name one owner for query validation, source resolution, semantic availability, citation/provenance, not-found, and answer assembly.
- Use generated routine transport and direct domain result types.
- Retain adapters only for meaningful query transforms, provider mapping, wire decoding, or rendering.
- Delete forwarding wrappers, copied result unions, local/daemon parity matrices, provider resets, and lifecycle fixtures.

## Must Not Complete While

Any behavior or file is unclassified, any surface repeats the domain result matrix, or test code is displaced into support data.

## Done When

The inventory has zero unresolved rows and retained surface scenarios each name a failure not caught at the domain owner.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
