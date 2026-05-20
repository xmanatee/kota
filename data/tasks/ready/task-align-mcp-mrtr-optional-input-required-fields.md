---
id: task-align-mcp-mrtr-optional-input-required-fields
title: Align MCP MRTR optional input-required fields
status: ready
priority: p2
area: core
summary: Update MCP client and server MRTR handling so input_required results accept inputRequests and requestState independently per the current draft while preserving strict requestState verification when state is present.
created_at: 2026-05-20T13:02:54.000Z
updated_at: 2026-05-20T13:02:54.000Z
---

## Problem

KOTA already implements draft MCP MRTR for first-party MCP server flows and
remote MCP tool results, but the current types and validators require every
`input_required` result to carry both `inputRequests` and `requestState`.

The current MCP draft MRTR page allows those fields independently: an
`InputRequiredResult` may carry input requests, request state, or both, and
must include at least one. That means a compliant remote server can ask for
client input without a state token, or return a state-only retry request, while
KOTA currently rejects or cannot represent that shape.

## Desired Outcome

KOTA's MCP client and first-party MCP server model the MRTR result shape exactly
once and accept the draft-permitted combinations without weakening the existing
request-state safety rules.

## Constraints

- Keep the MCP client boundary in `src/core/mcp/` and the first-party server
  boundary in `src/modules/mcp-server/`.
- Do not reintroduce standalone draft `roots/list`, `sampling/createMessage`,
  or `elicitation/create` server-to-client JSON-RPC calls. MRTR remains the
  single draft mechanism for those requests.
- Preserve the existing requestState integrity checks when requestState is
  present. State remains opaque to clients and attacker-controlled on retry.
- Fail loudly when an `input_required` result includes neither `inputRequests`
  nor `requestState`, when `inputRequests` is malformed, or when retry state
  fails verification.
- Keep exact MCP wire details in source types and focused tests, not durable
  docs.

## Done When

- `src/core/mcp/client.ts` decodes remote `input_required` tool results where:
  `inputRequests` only, `requestState` only, and both fields are present.
- `McpManager` either routes or returns explicit diagnostics for each accepted
  remote shape without fabricating missing state or input responses.
- `src/modules/mcp-server/mcp-protocol-types.ts` and MRTR helpers represent the
  optional-field contract without a parallel result type.
- First-party MCP server handlers still emit integrity-protected requestState
  when KOTA needs to bind retries to an originating method and parameters.
- Tests reject `input_required` results containing neither field, and retain
  existing malformed-input and bad-requestState failures.

## Source / Intent

Official MCP draft MRTR page refreshed on 2026-05-20:
https://modelcontextprotocol.io/specification/draft/basic/utilities/mrtr

That page says MRTR replaces standalone server-initiated requests, limits
`InputRequiredResult` to `prompts/get`, `resources/read`, and `tools/call`, and
allows `inputRequests` and `requestState` to be independently optional as long
as at least one is present.

Existing completed KOTA tasks already cover the larger MRTR migration:
`task-align-mcp-outbound-client-feature-requests-with-mrtr`,
`task-support-mcp-draft-tool-result-variants`, and
`task-route-remote-mcp-input-required-results-through-operator-surface`. This
task is the remaining protocol-fidelity slice exposed by reading the standalone
MRTR utility page.

## Initiative

MCP protocol fidelity: KOTA should interoperate with compliant draft MCP peers
without adding parallel protocol surfaces or weakening internal strictness.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Test cases prove all three valid optional-field combinations and the invalid
  neither-field case.
