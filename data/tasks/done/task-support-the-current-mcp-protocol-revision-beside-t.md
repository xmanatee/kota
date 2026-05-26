---
id: task-support-the-current-mcp-protocol-revision-beside-t
title: Support the current MCP protocol revision beside the active draft
status: done
priority: p2
area: modules
summary: Let KOTA's first-party MCP server and external MCP client negotiate the official 2025-11-25 protocol revision while keeping DRAFT-2026-v1 as an explicit experimental path, so current compliant clients are not rejected.
created_at: 2026-05-26T00:10:31.447Z
updated_at: 2026-05-26T00:32:44Z
---

## Problem

KOTA has been aggressively tracking MCP draft and extension details, but its
protocol-version boundary no longer includes the official current revision.
Both the first-party MCP server and external MCP client currently model only:

- `2024-11-05` as the legacy path.
- `DRAFT-2026-v1` as the modern/draft path.

The official MCP specification now redirects the latest stable spec to
`2025-11-25`, and its changelog lists the features KOTA has been implementing
piecemeal: OIDC-enhanced authorization discovery, metadata icons, URL-mode
elicitation, sampling with tools, Tasks, HTTP Origin behavior, JSON Schema
2020-12, and related schema changes. A compliant current MCP client or server
that negotiates `2025-11-25` can therefore be rejected as unsupported even when
KOTA already implements the relevant feature behavior under the draft constant.

This is a protocol interoperability gap, not a new MCP feature request.

## Desired Outcome

KOTA treats MCP protocol revisions as an explicit compatibility matrix. The
official current revision (`2025-11-25`) is negotiated by both the first-party
server and external client, while `DRAFT-2026-v1` remains a deliberate
experimental path for release-candidate-only behavior.

Current-revision peers should get the current stable contract. Draft-only
features should either be absent, warned as experimental, or version-gated
behind `DRAFT-2026-v1`; they should not silently leak into stable negotiation.

## Constraints

- Keep exact protocol revision constants, feature gates, and wire contracts in
  source and focused tests, not durable docs.
- Touch both MCP ownership boundaries deliberately:
  `src/modules/mcp-server/` for KOTA as an MCP server, and `src/core/mcp/` for
  KOTA as an external MCP client.
- Preserve the existing `2024-11-05` compatibility path unless a focused test
  proves it is no longer reachable or intentionally removed.
- Do not collapse current stable and draft behavior into one boolean named
  `draft`. Give callers a typed way to ask whether a negotiated revision has a
  specific feature.
- Do not add permissive fallback that accepts arbitrary version strings. Unknown
  or malformed versions should still fail loudly with supported-version data.
- Avoid a large feature rewrite. The main outcome is version negotiation and
  version-scoped feature gating; deeper feature mismatches discovered while
  doing the work should become follow-up tasks.

## Done When

- Shared MCP protocol types in `src/core/mcp/` and
  `src/modules/mcp-server/` define `2025-11-25` as the current stable revision
  and include it in supported-version negotiation.
- The first-party MCP server accepts `2025-11-25` through both
  `initialize` and request-scoped metadata where applicable, and rejects
  unsupported versions with the existing supported-version diagnostic shape.
- The external MCP client starts negotiation with the current stable revision
  by default, can still fall back to legacy `2024-11-05`, and only uses
  `DRAFT-2026-v1` when a server explicitly supports the active draft path.
- Feature checks that currently mean "modern" are expressed as typed revision
  capabilities: stable 2025-11-25 behavior, draft-only behavior, and legacy
  behavior are distinct in code and tests.
- Current-stable fixtures cover at least one representative operation on each
  side: `server/discover` or `initialize`, `tools/list`, `tools/call` with
  structured content, one resource/prompt operation, and one extension
  negotiation path such as Tasks or Apps.
- Existing draft and legacy MCP tests remain green, or any intentionally
  changed behavior is recorded in the task completion notes with the test that
  proves it.

## Source / Intent

Explorer run `2026-05-26T00-07-57-978Z-explorer-j076ia` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://modelcontextprotocol.io/specification` redirects to
  `https://modelcontextprotocol.io/specification/2025-11-25` and labels it the
  latest spec.
- `https://modelcontextprotocol.io/specification/2025-11-25/changelog` lists
  2025-11-25 changes including OIDC authorization discovery, icons for tools
  and resources, URL-mode elicitation, sampling tool calls, Tasks, Streamable
  HTTP Origin clarification, JSON Schema 2020-12, and related schema changes.
- `https://blog.modelcontextprotocol.io/tags/protocol/` identifies the
  2026-07-28 release candidate as a draft/future release track, distinct from
  the stable latest spec.

Local evidence:

- `src/core/mcp/client-protocol.ts` defines only `2024-11-05` and
  `DRAFT-2026-v1` as `McpProtocolVersion`.
- `src/modules/mcp-server/mcp-protocol-types.ts` defines only `2024-11-05` and
  `DRAFT-2026-v1`, and `MCP_SUPPORTED_PROTOCOL_VERSIONS` omits `2025-11-25`.
- `data/tasks/done/task-align-mcp-server-draft-discovery-and-per-requ.md`
  intentionally targeted `DRAFT-2026-v1` discovery/per-request metadata rather
  than stable current-version negotiation.
- Recent completed MCP tasks cover many current feature details, but no open or
  completed task owns stable `2025-11-25` negotiation end to end.

## Initiative

MCP protocol fidelity: KOTA should interoperate with stable current MCP peers
without confusing latest released protocol support with active draft support.

## Acceptance Evidence

- Focused MCP protocol tests pass for both boundaries, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- A current-stable fixture or test transcript proves a `2025-11-25` server peer
  can connect through the external MCP client and a `2025-11-25` client peer can
  use KOTA's first-party MCP server.
- A negative fixture proves an unknown version still fails loudly and reports
  supported versions including `2025-11-25`.
