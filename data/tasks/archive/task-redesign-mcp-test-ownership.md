---
status: dropped
---

# Redesign MCP verification ownership

## Outcome

MCP decoder, policy, transport, client, manager, server, and interoperability behavior each have one owner while authentication, OAuth, negotiation, redaction, replay/cache safety, limits, and untrusted-peer handling remain explicit.

## Tracked Slices

- [ ] task-consolidate-mcp-protocol-client-ownership
- [ ] task-isolate-mcp-manager-behavior
- [ ] task-reduce-mcp-server-interoperability-suite

## Done When

All three inventories have zero unresolved scenarios and no manager-owned inline protocol server, copied transport/OAuth/pagination matrix, or generic server dispatch duplication remains.

## Initiative

Lean behavioral verification: preserve protocol confidence without fixture duplication.

## Disposition

This strategic tracking record is retired because initiatives are not executable tasks. Its child tasks retain the actionable outcomes and dependency structure.
