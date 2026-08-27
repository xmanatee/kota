---
status: done
---

# Rewrite MCP client orchestration into focused protocol components

## Problem

`src/core/mcp/manager.ts` is over 2,000 lines and combines declaration
adaptation, lifecycle, tool and operation execution, input requests, sampling,
progress, list caching, remote skills, remote tasks, diagnostics, and shutdown.
That directly conflicts with the MCP directory's per-protocol ownership rule.

## Desired Outcome

Rewrite MCP client orchestration as a small `McpManager` lifecycle facade over
focused typed components for declaration/catalog assembly, tool execution,
operation execution, list caching, input/progress routing, remote skills,
remote tasks, diagnostics, and connection shutdown.

## Constraints

- Preserve one MCP client runtime and all supported negotiated protocol
  behavior; do not create a second manager or public API.
- Keep JSON-RPC, transport, OAuth, task, sampling, resource, prompt, and tool
  edge cases in their existing owning protocol adapters.
- Characterize current live/reconnect/error behavior before replacement.
- Move state to the component that owns its invariant; do not merely cut the
  file into helpers sharing one mutable manager object.
- Delete superseded functions and tests after callers move; no forwarding
  compatibility facade beyond the final small orchestrator.

## Done When

- `McpManager` owns only lifecycle coordination and delegates focused concerns
  through explicit typed interfaces.
- Tool declarations, cached lists, input/progress flows, remote skills/tasks,
  reconnect, and close behavior retain production and failure semantics.
- No sibling component reaches through another component's mutable state.
- The MCP boundary has focused tests per concern plus live manager composition
  tests, with the monolithic implementation removed.

## Source / Intent

Owner-approved targeted rewrite from the 2026-08-24 architecture audit. The
goal is ownership clarity, not an arbitrary line-count reduction.

## Initiative

Clean core protocol ownership.

## Acceptance Evidence

- Characterization and post-rewrite integration results for initialization,
  execution, caching, input/progress, remote tasks, reconnect, and shutdown.
- Dependency/state-ownership diagram generated from source imports.
- Structural report proving the retired monolithic concern implementations are
  absent and no second manager path exists.
