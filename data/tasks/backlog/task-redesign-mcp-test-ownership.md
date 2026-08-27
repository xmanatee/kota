---
id: task-redesign-mcp-test-ownership
title: Redesign MCP verification ownership
status: backlog
priority: p1
area: mcp
summary: Track protocol/client, manager, and server/interoperability ownership as bounded slices.
task_class: Platform
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
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
