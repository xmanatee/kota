---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences]
---

# Consolidate MCP protocol and client ownership

## Scope / Starting Points

Inventory `src/core/mcp` for JSON-RPC decoding, initialization, capability negotiation, stdio/HTTP framing, OAuth binding, pagination, input-required, errors, caching/replay, limits, redaction, inline peers, and test utilities.

## Required Changes

- Assign codecs, endpoint policy, transport framing, and client state to explicit owners.
- Derive method and capability catalogs from canonical types/decoders rather than literal test copies.
- Replace bespoke inline peers with a bounded protocol-owned peer set.
- Retain representative valid and adversarial messages for authentication, OAuth, redaction, replay/cache safety, input-required, pagination, limits, and untrusted peers.
- Delete duplicated client matrices and compatibility protocol formats with no supported peer.

## Must Not Complete While

Any protocol scenario is unclassified, any literal catalog is frozen in ordinary tests, or any behavior has duplicate codec/policy/transport owners.

## Done When

The scenario inventory has zero unresolved rows and the compact portfolio owns every supported protocol/security failure once.

## Acceptance Evidence

Provide the scenario/owner/disposition matrix, supported peer/transport table, and before/after executable-test and authored-support LOC.

## Initiative

Child of `task-redesign-mcp-test-ownership`.
