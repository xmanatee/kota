---
id: task-redesign-mcp-test-ownership
title: Redesign MCP protocol and manager test ownership
status: backlog
priority: p1
area: mcp
summary: Separate MCP decoder, policy, transport, client, manager, server, and interoperability ownership while preserving protocol and security confidence with far less fixture duplication.
task_class: Platform
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Large MCP client, manager, and server suites repeat inline JSON-RPC peers, HTTP recorders, initialization, pagination, OAuth, input-required, cache, task resume, error framing, and transport behavior. Manager tests frequently re-exercise client protocol logic, and server handler suites repeat generic dispatch semantics.

## Desired Outcome

Compact decoder and policy owners cover representative and adversarial messages; a small protocol cadence owns transport framing and limits; one real client/server interoperability matrix covers stdio and Streamable HTTP; McpManager uses a narrow injected client port and owns registry, routing, refresh, task resume, and multi-server composition; server handlers own method-specific semantics.

## Constraints

- Preserve authentication, OAuth binding, capability negotiation, redaction, input-required, replay or cache safety, message limits, and untrusted-peer handling.
- Canonical types and decoders own method and capability catalogs; do not freeze every literal in tests.
- Replace dozens of bespoke inline peers with a few protocol-owned peers, not a broad mock framework.
- Do not retain manager copies of transport, OAuth, pagination, or payload-decoding scenarios.

## How We Will Know

- Every retained MCP scenario names its decoder, policy, transport, client, manager, server, or interoperability owner.
- Manager tests run against a narrow client port and no longer embed protocol servers for client-owned behavior.
- A real interoperability matrix preserves confidence across supported transports and security limits.
- Combined MCP client, manager, and server test LOC approaches the investigation target near 13k, a non-additive reduction of roughly 10k-14k.
