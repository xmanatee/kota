---
id: task-align-mcp-client-elicitation-with-the-current-draft
title: Align MCP client elicitation with the current draft
status: ready
priority: p2
area: core
summary: Advertise KOTA's remote MCP elicitation support in draft per-request metadata and align elicitation responses with the current decline/cancel semantics without weakening URL-mode safety.
created_at: 2026-05-20T23:40:02Z
updated_at: 2026-05-20T23:40:02Z
---

## Problem

KOTA can now decode and route remote MCP `input_required` tool results,
including form and URL mode `elicitation/create` requests. That makes the
runtime more capable than the draft metadata it sends to remote MCP servers:
`src/core/mcp/client.ts` still initializes with an empty capability object and
sends draft `tools/list`, `tools/call`, and subscription requests without
per-request `_meta.io.modelcontextprotocol/clientCapabilities`.

The current draft elicitation page also uses `accept`, `decline`, and `cancel`
as response actions, while KOTA's MCP client and first-party MCP server still
model the negative user action as `reject`. That drift makes KOTA look
compatible with earlier draft examples while a current draft peer can reject
or misinterpret a valid operator decline.

## Desired Outcome

KOTA's MCP elicitation boundary matches the current draft on both sides of the
connection:

- remote draft requests sent by KOTA include request-scoped protocol metadata
  and advertise the elicitation modes KOTA can actually route;
- form and URL mode responses use the current `decline` action at draft
  boundaries, with any legacy `reject` compatibility kept explicit and
  narrowly tested;
- URL-mode safety remains intact: KOTA shows the full URL and elicitation id,
  does not prefetch or open the URL automatically, and never asks the operator
  to paste sensitive URL output into form content.

## Constraints

- Keep the remote MCP client boundary in `src/core/mcp/`; touch
  `src/modules/mcp-server/` only where first-party server protocol types or
  tests need to emit or accept current draft elicitation responses.
- Do not reintroduce standalone draft `elicitation/create` JSON-RPC requests.
  Draft elicitation remains carried through MRTR `input_required` results.
- Do not add a browser automation flow, OAuth provider, credential store, or
  automatic URL opener. This is protocol metadata and response semantics.
- Do not silently accept both `reject` and `decline` on the same draft path
  without naming the compatibility reason in code or tests.
- Keep exact MCP wire details in source types and focused tests, not durable
  docs.

## Done When

- `McpClient` sends draft per-request metadata on outgoing remote MCP requests
  where current draft servers expect it, including protocol version, client
  info, and client capabilities.
- KOTA advertises elicitation capability only for modes it can safely handle;
  current support should include form mode and URL mode when the operator input
  bridge is available.
- Remote MCP input response validation accepts and sends the current draft
  `decline` action, while `accept` and `cancel` keep their existing strict
  behavior.
- First-party MCP server draft elicitation/MRTR tests use `decline` at draft
  boundaries, with any remaining `reject` path proven to be legacy
  compatibility or removed.
- Unknown or stale `notifications/elicitation/complete` messages are ignored
  safely; if KOTA records URL-mode completion state, it remains keyed by the
  original `elicitationId` and does not automatically disclose or fetch URL
  contents.
- Existing MCP client, manager, operator-input, and first-party server tests
  remain green.

## Source / Intent

Explorer run `2026-05-20T22-30-50-400Z-explorer-yd1lvg` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align MCP client elicitation with the current draft" --state ready --area core --priority p2 --summary "Advertise KOTA's remote MCP elicitation support in draft per-request metadata and align elicitation responses with the current decline/cancel semantics without weakening URL-mode safety."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/client/elicitation` is
  the official MCP draft elicitation page. It says clients that support
  elicitation declare the `elicitation` capability in per-request client
  capabilities, distinguishes form and URL modes, requires URL-mode requests
  to include `url` and `elicitationId`, and defines response actions as
  `accept`, `decline`, and `cancel`.

Local evidence:

- `src/core/mcp/client.ts` currently sends `capabilities: {}` during
  initialization and does not attach draft per-request `_meta` to remote
  `tools/list` or `tools/call` requests.
- `src/core/mcp/client.ts`, `src/core/mcp/operator-input.ts`,
  `src/modules/mcp-server/mcp-protocol-types.ts`, and
  `src/modules/mcp-server/mcp-mrtr.ts` still model the negative elicitation
  response as `reject`.
- Completed tasks already cover MRTR request association, optional
  `input_required` fields, remote input routing, and URL-mode safety. This
  task is the remaining current-draft client elicitation alignment slice.

## Initiative

MCP protocol fidelity: KOTA should interoperate with current draft MCP peers
through one strict typed boundary instead of silently depending on stale draft
response names or under-advertised client capabilities.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Focused operator-input tests pass, for example:
  `pnpm test src/core/mcp/operator-input.test.ts`.
- Focused first-party MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts`.
- Test fixtures prove KOTA advertises draft elicitation capabilities only when
  it can route the requested mode, accepts/sends `decline` at draft
  boundaries, and keeps URL-mode consent-only behavior intact.
