---
status: open
priority: p1
depends_on: [task-consolidate-mcp-protocol-client-ownership]
---

# Isolate MCP manager behavior

## Scope / Starting Points

Inventory `src/core/mcp/manager*`, `src/modules/mcp-registry`, manager fixtures, embedded servers, transport/OAuth/pagination cases, refresh, routing, caches, task resume, and multi-server behavior.

## Required Changes

- Define a narrow injected MCP client port exposing only manager-required operations and events.
- Keep registry, server selection, routing, refresh, cache coordination, task resume, and multi-server composition in the manager.
- Move payload decoding, framing, OAuth, pagination, and transport failure matrices to protocol/client ownership.
- Delete embedded protocol servers, HTTP recorders, copied initialization, and client-owned scenarios from manager suites.

## Must Not Complete While

Any manager scenario is unclassified, any manager test boots a protocol peer for client-owned behavior, or any client protocol branch remains copied in the manager.

## Done When

The scenario inventory has zero unresolved rows and manager suites exercise only manager-owned decisions through the narrow port.

## Acceptance Evidence

Provide the manager/scenario/disposition matrix, port surface, and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-redesign-mcp-test-ownership`.
