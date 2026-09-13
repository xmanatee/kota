---
status: open
priority: p2
---

# Interoperate with stable MCP 2026-07-28 peers

## Problem

The official release page identifies `2026-07-28` as stable, but KOTA's external
MCP client and first-party server accept only `2025-11-25`, `DRAFT-2026-v1` and
`2024-11-05`. A September 13 production-decoder probe of an initialize result
with `protocolVersion: 2026-07-28` throws `Malformed MCP initialize result`;
the server's production version predicate returns false for the same revision.
Peers requiring the released revision cannot negotiate it with KOTA.

The archived `task-support-the-current-mcp-protocol-revision-beside-t` owns the
earlier 2025 stable upgrade. No active task owns this later compatibility gap.

## Outcome And Acceptance

Support the final `2026-07-28` contract through the existing client and server
owners, so a peer using that revision can connect and perform a representative
tool operation in either direction. Read the final versioned specification and
changelog before deciding feature gates; the release announcement proves release
status, not equivalence to KOTA's synthetic draft contract.

Preserve intentional older-peer compatibility and strict rejection of unknown
versions. Align negotiation, HTTP version handling and revision-dependent
capabilities with the final contract across maintained transports. Do not merely
rename the draft constant or advertise features whose final semantics are unmet.
Keep this one interoperability outcome with the existing MCP owners rather than
creating a parallel protocol stack or a task for every specification page.

Verify actual client/server exchanges through their production boundaries,
including a useful tool result, prior-version negotiation and unsupported-version
diagnostics. Retain a representative transcript; source predicates alone do not
establish working interoperability. Use proportionate existing owner/protocol
coverage for affected capability and transport differences.

## Evidence

- https://github.com/modelcontextprotocol/modelcontextprotocol/releases,
  runtime observation `2026-09-13T11:24:22.377Z`, fingerprint
  `sha256:bb544817036008ff589d06c7cb0be6fd`, identifies the stable release and links
  https://modelcontextprotocol.io/specification/2026-07-28 and its `/changelog`.
  The linked final text was not read in this discovery pass.
- Explorer run `2026-09-13T01-25-22-195Z-explorer-ivm5rm` executed
  `decodeInitializeResult` from `src/core/mcp/client-initialize-decoders.ts`
  and `isMcpProtocolVersion` from
  `src/modules/mcp-server/mcp-protocol-types.ts`. The former rejects the released
  revision; the latter excludes it. This was a local boundary probe, not a live
  peer exchange. The run summary retains the output and source provenance.
