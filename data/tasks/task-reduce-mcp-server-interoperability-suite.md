---
status: open
priority: p1
depends_on: [task-consolidate-mcp-protocol-client-ownership, task-isolate-mcp-manager-behavior]
---

# Reduce MCP server and interoperability duplication

## Scope / Starting Points

Inventory `src/modules/mcp-server`, server handlers, stdio and Streamable HTTP hosts, generic dispatch tests, method-specific semantics, authentication/limits, and client/server integration matrices.

## Required Changes

- Keep server handlers focused on method-specific tools, resources, prompts, sampling, tasks, and authorization semantics.
- Remove generic dispatch, codec, framing, pagination, and client-policy copies already owned in core MCP.
- Retain one real client/server interoperability matrix spanning stdio and Streamable HTTP plus explicit authentication, redaction, and message-limit boundaries.
- Delete overlapping mock integrations and bespoke peers after the real matrix owns their distinct risk.

## Must Not Complete While

Any server scenario is unclassified, any generic protocol matrix remains copied, or the retained interoperability path mocks away the transport boundary.

## Done When

The scenario inventory has zero unresolved rows and every retained server/interoperability scenario names a method, transport, or security failure unique to this layer.

## Acceptance Evidence

Provide the handler/scenario/disposition matrix, real transport matrix, and combined MCP before/after executable-test and authored-support LOC.

## Initiative

Child of `task-redesign-mcp-test-ownership`.
