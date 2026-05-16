---
id: task-support-mcp-draft-tool-result-variants
title: Support MCP draft tool result variants
status: ready
priority: p2
area: modules
summary: Align the MCP server tools/call response contract with the draft tools spec by handling explicit result types and standard input-required tool results at the MCP adapter boundary.
created_at: 2026-05-16T10:17:17Z
updated_at: 2026-05-16T10:17:17Z
---

## Problem

KOTA's MCP server currently exposes tools through
`src/modules/mcp-server/mcp-handlers-tools.ts` using the older
`tools/call` result shape: a successful call returns `content`,
optional `structuredContent`, optional `_meta`, and optional `isError`.
That already covers the client-runtime metadata preservation task that
landed earlier on 2026-05-16, but it does not cover the current MCP
draft's server-side result variants.

The draft tools spec now models a completed tool result with an
explicit `resultType: "complete"` and adds a standard
`resultType: "input_required"` branch where a tool can return
`inputRequests` plus `requestState`, then accept `inputResponses` on a
retry request. KOTA has adjacent behavior for `confirm` via
server-initiated elicitation, but the MCP server has no typed
`tools/call` result union and no conformance coverage for these result
variants. As the MCP draft hardens, KOTA can appear to support tools
while silently speaking a stale result contract.

## Desired Outcome

The MCP server has a strict, typed `tools/call` result protocol that
can represent both completed tool results and draft input-required
results without erasing existing metadata:

- completed calls return the draft `complete` result shape when the
  negotiated protocol requires it, including content,
  `structuredContent`, `_meta`, and `isError`;
- tools that need client input can return an MCP-standard
  `input_required` result with deterministic request ids, typed
  `inputRequests`, and an opaque `requestState`;
- retry calls that include `inputResponses` and `requestState` resume
  the pending tool interaction through the same handler rather than a
  parallel prompt path;
- older protocol-version behavior is either intentionally preserved at
  the negotiation boundary or deliberately upgraded with tests that
  name the compatibility decision.

## Constraints

- Keep the work inside `src/modules/mcp-server/`; the core MCP client
  side remains in `src/core/mcp/` and should not import the server
  module.
- Follow the module's per-feature split: `mcp-handlers-tools.ts` owns
  tools/list and tools/call behavior, while `server.ts` stays
  lifecycle and dispatch glue.
- Do not add a loose `Record<string, unknown>` result bag as the public
  protocol. Model the `complete` and `input_required` branches as a
  discriminated TypeScript union and validate malformed retry payloads
  loudly at the MCP boundary.
- Treat MCP protocol versions as a real external I/O boundary. If KOTA
  needs to keep a 2024-11-05 response shape for older clients, make
  that a named negotiation branch with tests instead of an implicit
  stale default.
- Preserve existing elicitation behavior only if it remains the
  canonical path for the negotiated protocol. Avoid two independent
  ways for the same KOTA tool to ask the same client for the same input.
- Do not move exact MCP payload catalogs into durable docs; keep wire
  details in source types and focused protocol tests.

## Done When

- `tools/call` responses are produced through a typed union that
  includes at least `complete` and `input_required`.
- The initialize/session state records enough negotiated protocol
  information for the tools handler to choose the correct response
  shape deliberately.
- A focused MCP-server test proves a normal tool call returns the
  complete result branch without dropping content, structured content,
  `_meta`, annotations, or `isError`.
- A focused MCP-server test uses a tool requiring client input, observes
  an `input_required` result with `inputRequests` and `requestState`,
  retries with `inputResponses`, and asserts the tool completes through
  the same tools/call path.
- Malformed retry payloads and unknown request state fail as JSON-RPC
  protocol errors; tool-execution failures still return tool results
  with `isError` so models can self-correct.
- Existing MCP server, client, sampling, elicitation, completion,
  roots, and resource tests remain green.

## Source / Intent

Explorer run `2026-05-16T10-15-32-800Z-explorer-cmiaie` reviewed the
queue while there were no actionable tasks. The strategic blocked
alternatives were all still gated on operator-captured evidence, so this
opens a ready module slice instead of adding another blocked task.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools`
  is the official MCP draft Tools page. The page documents explicit
  tool result variants, including completed results with
  `resultType: "complete"` and input-required results with
  `resultType: "input_required"`, `inputRequests`, `requestState`,
  retry-time `inputResponses`, structured content, resource links,
  output schema validation, and tool-execution errors via `isError`.

Local evidence:

- `src/modules/mcp-server/mcp-handlers-tools.ts` returns only the older
  content-based shape today.
- `src/modules/mcp-server/mcp-handlers-initialize.ts` hardcodes
  `protocolVersion: "2024-11-05"` and does not retain a negotiated
  protocol-version field in session state.
- `data/tasks/done/task-preserve-mcp-tool-result-metadata-through-the-client-runtime.md`
  already covers external MCP client result preservation; this task is
  the server-side result-variant follow-up, not a duplicate.

## Initiative

MCP protocol fidelity: KOTA should expose module-owned tools over MCP
through a current, explicit protocol boundary rather than relying on
stale wire-shape assumptions.

## Acceptance Evidence

- Test transcript for focused MCP server protocol coverage, for example
  `pnpm test src/modules/mcp-server/server.test.ts`.
- If protocol-version negotiation changes, include a focused transcript
  for the initialize/tools-call cases that proves both the selected
  current shape and any intentionally retained older shape.
- Diff review shows `tools/call` result construction uses a typed
  result union and does not stringify or drop `structuredContent`,
  `_meta`, annotations, resource links, or `isError`.
