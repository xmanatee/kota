---
id: task-fingerprint-remote-mcp-tool-declarations-across-re
title: Fingerprint remote MCP tool declarations across registry refreshes
status: ready
priority: p2
area: core
summary: Record stable fingerprints for remote MCP tool declarations from tools/list and surface changed descriptions, schemas, or annotations across refreshes so long-lived sessions can audit advertised tool-contract drift.
created_at: 2026-06-22T15:38:27.874Z
updated_at: 2026-06-22T15:38:27.874Z
---

## Problem

KOTA can connect to external MCP servers, namespace their `tools/list` results,
refresh those tools on `notifications/tools/list_changed`, validate schemas,
and carry remote-result provenance into telemetry and injection-defense.
Those are the right runtime boundaries, but they still do not make the
advertised tool contract itself auditable across a long-lived session.

When a remote MCP server changes a tool's natural-language description,
input schema, output schema, or annotations, KOTA replaces the registry entry
and keeps going. That is correct protocol behavior for availability, but weak
security and review behavior: an operator or later run artifact cannot tell
whether `mcp__server__tool` still means the same advertised action it meant at
approval time, at task-handle creation time, or at the start of the session.

KOTA cannot generally inspect a remote MCP server's implementation, so this is
not a request for code attestation or a marketplace scanner. The local gap is
smaller and actionable: fingerprint the list-time declaration KOTA actually
trusts, persist or expose that fingerprint in the runtime evidence, and surface
meaningful declaration drift when a refreshed registry changes the contract
behind an existing namespaced tool.

## Desired Outcome

Remote MCP tool declarations have stable, deterministic fingerprints derived
from their advertised protocol contract.

At minimum, the fingerprint input should cover:

- server config name and server display identity;
- original remote tool name;
- description text, including missing-description state;
- normalized input schema;
- normalized output schema, when present;
- annotations such as read-only, destructive, idempotent, and open-world hints;
  and
- protocol-visible task/input-required support metadata if it is stored on the
  tool entry.

KOTA should surface declaration fingerprints wherever they help audit remote
tool behavior:

- MCP manager state and tests can inspect the current declaration fingerprint
  for a namespaced tool.
- Tool-call telemetry or run artifacts record the fingerprint for remote MCP
  calls, so a later reviewer can tie a call to the contract KOTA saw.
- `tools/list_changed` refreshes compare previous and next fingerprints for
  the same server/tool pair and emit a bounded diagnostic when a tool's
  description, schema, output schema, or annotations changed.
- Persisted remote task handles either record the declaration fingerprint used
  when the task was created or explicitly prove why the existing server
  fingerprint is enough for resume safety.

## Constraints

- Keep implementation in `src/core/mcp/` and adjacent shared tool telemetry
  plumbing. Do not import MCP-server module helpers back into core.
- Reuse KOTA's existing stable JSON/stringification or hashing helpers if
  available; do not compare raw object insertion order.
- Do not reject every declaration change. Servers are allowed to update tools;
  KOTA should make the drift inspectable and prevent stale evidence from
  looking unchanged.
- Do not expose raw secret-bearing inputs, authorization headers, tool result
  payloads, or remote resource contents in the fingerprint material. This is
  about advertised declarations, not executions.
- Preserve existing `tools/list_changed` behavior: a malformed refreshed list
  keeps the last known-good registry, and a successful refresh still adds and
  removes tools normally.
- Do not build a marketplace-scale MCP scanner, static code analyzer, or
  cryptographic attestation system in this slice.

## Done When

- `McpManager` stores a deterministic declaration fingerprint on each remote
  tool entry and can expose it for diagnostics/tests without leaking full raw
  tool declarations into unrelated surfaces.
- The fingerprint changes when a remote tool's description, input schema,
  output schema, or annotations change, and stays stable across irrelevant
  object key ordering differences.
- A `tools/list_changed` refresh emits or records a bounded diagnostic for a
  same server/tool name whose declaration fingerprint changed, naming which
  top-level declaration facets changed without printing sensitive content.
- Remote MCP tool-call telemetry or run evidence includes the declaration
  fingerprint for executed remote tools.
- Remote task persistence/resume either includes the declaration fingerprint
  or has focused tests proving server identity fingerprinting fully covers the
  resume safety invariant.
- Focused MCP manager/tool-runner tests cover unchanged refresh, description
  drift, schema drift, annotation drift, object-order stability, removed tool,
  added tool, and malformed refresh preserving last known-good entries.

## Source / Intent

Explorer run `2026-06-22T15-23-52-045Z-explorer-ip30z8` reviewed a thin queue:
one actionable p3 cleanup task, no backlog, and
`inspect-queue.strategicReadyCoverageGap=true`. The strategic blocked
alternatives were all legitimate operator-capture waits and not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External sources checked:

- `https://arxiv.org/abs/2602.03580` ("Don't believe everything you read:
  Understanding and Measuring MCP Behavior under Misleading Tool
  Descriptions", submitted February 3, 2026) frames description-code
  inconsistency as an MCP attack surface. KOTA should not import the paper's
  marketplace scanner, but the source makes advertised tool-description drift a
  concrete risk for agents that reason over natural-language tool contracts.
- `https://arxiv.org/abs/2604.05969` ("A Formal Security Framework for
  MCP-Based AI Agents", submitted April 7, 2026) reinforces defense in depth
  for MCP tool chains, including capability-aware boundaries and runtime policy
  enforcement. KOTA already has effect metadata, approval gating, and
  injection-defense; this task adds declaration-level evidence at the remote
  MCP boundary.

Local overlap check:

- `task-refresh-remote-mcp-tool-registries-on-toolslistcha` is done and handles
  event-driven refresh, but it does not record per-tool declaration
  fingerprints or drift diagnostics for changed contracts.
- `task-validate-remote-mcp-tool-output-schemas-in-the-client-runtime` is done
  and enforces advertised output schemas at execution time, but it does not
  preserve an audit fingerprint of the declaration an execution relied on.
- `task-screen-remote-mcp-tool-results-through-injection-d` is done and screens
  external MCP result content by provenance, but result-content provenance does
  not identify whether the tool's advertised description/schema changed during
  a session.
- `src/core/mcp/manager.ts` already namespaces remote tool names, stores server
  names and annotations, refreshes registries, and records server fingerprints
  for persisted remote tasks. The missing piece is the tool-declaration
  fingerprint and drift surface, not another MCP tool registry or scanner.

## Initiative

MCP security and auditability: KOTA should consume remote tools through a
strict boundary where the advertised contract an agent sees is durable enough
for approval review, telemetry, task resume, and post-run investigation.

## Acceptance Evidence

- Focused test transcript for MCP manager and tool-runner/telemetry coverage,
  for example:
  `pnpm test src/core/mcp/manager.test.ts src/core/tools/tool-runner-mcp-provenance.test.ts src/core/tools/tool-telemetry-mcp-provenance.test.ts`.
- Fixture or test output showing before/after fingerprints for unchanged
  refresh, description drift, schema drift, annotation drift, added tool, and
  removed tool.
- Sample diagnostic from a changed remote declaration that names the server,
  remote tool name, old/new fingerprint prefix, and changed facets without
  printing tool-result content or credentials.
- `pnpm run validate-tasks` passes after the implementation task moves through
  the queue.
