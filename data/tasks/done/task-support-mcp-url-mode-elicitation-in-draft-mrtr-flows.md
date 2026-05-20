---
id: task-support-mcp-url-mode-elicitation-in-draft-mrtr-flows
title: Support MCP URL-mode elicitation in draft MRTR flows
status: done
priority: p2
area: modules
summary: Model MCP elicitation client capabilities as form/url modes and route URL-mode input_required requests without exposing sensitive data through form responses.
created_at: 2026-05-20T16:59:27.000Z
updated_at: 2026-05-20T18:45:27.000Z
---

## Problem

KOTA now uses draft MCP MRTR `input_required` results for first-party
server-to-client requests and remote MCP tool results, but its elicitation
model still only represents form-mode requests.

The current draft client elicitation page adds URL mode for sensitive or
out-of-band interactions. KOTA's first-party MCP server types hard-code
`mode: "form"` for `elicitation/create`; its MRTR retry decoder requires
accepted elicitation responses to include a `content` object; the external MCP
client boundary applies the same "accept requires content" rule to every
remote input response. A compliant URL-mode flow can therefore be rejected or
misrepresented, and KOTA does not yet distinguish form-only clients from
clients that explicitly support URL mode.

## Desired Outcome

KOTA treats MCP elicitation modes as part of the protocol boundary:

- form mode remains the default and continues to require reviewed structured
  content when the user accepts;
- URL mode is represented explicitly with `url` and `elicitationId`;
- clients that advertise only the legacy empty elicitation object are treated
  as form-only;
- URL-mode accept/reject/cancel responses can round-trip through MRTR without
  asking the operator to paste sensitive values into JSON; and
- KOTA never opens, fetches, or summarizes the target URL automatically.

## Constraints

- Keep the first-party server work in `src/modules/mcp-server/`; touch
  `src/core/mcp/` only for remote MCP client decoding and the operator input
  bridge.
- Do not reintroduce standalone draft `elicitation/create` JSON-RPC calls.
  Draft URL-mode elicitation must stay inside MRTR `input_required` results.
- Do not add an OAuth provider, browser automation flow, or credential store in
  this task. This is protocol support and operator-consent routing only.
- Preserve strict form-mode validation. Do not weaken form-mode accept
  responses just to make URL mode pass.
- Keep exact MCP wire details in source types and focused tests, not durable
  docs.

## Done When

- First-party MCP server protocol types represent both form-mode and URL-mode
  `elicitation/create` input requests, including `url` and `elicitationId` for
  URL mode.
- Client capability checks distinguish form support from URL support: an empty
  `elicitation` capability remains form-only, `{ form: {} }` is form-capable,
  and `{ url: {} }` is URL-capable.
- MRTR retry decoding and verification allow URL-mode `accept` responses
  without `content`, while form-mode `accept` still requires a content object.
- The remote MCP client/operator input bridge can route a URL-mode
  `input_required` request by showing the server, tool, full URL, and
  elicitation id, then accepting only explicit operator consent/reject/cancel
  JSON. It must not prefetch or open the URL.
- Tests cover form-only capability, URL-capable capability, URL-mode success,
  URL-mode reject/cancel, a URL-mode request sent to a form-only client, and a
  form-mode accept response missing content.

## Source / Intent

The ready queue was empty while all strategic blocked alternatives still
required operator-captured artifacts, so this opens one protocol-fidelity slice
from current MCP draft reading instead of adding another blocked task.

The scaffold command was attempted first:

```sh
pnpm kota task create "Support MCP URL-mode elicitation in draft MRTR flows" --state ready --area modules --priority p2 --summary "Model MCP elicitation client capabilities as form/url modes and route URL-mode input_required requests without exposing sensitive data through form responses."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/client/elicitation` is
  the official MCP draft elicitation page. It defines form and URL modes,
  treats an empty elicitation capability as form-only compatibility, requires
  URL-mode requests to include `url` and `elicitationId`, and says clients must
  show the full URL and require explicit consent without automatically opening
  or prefetching it.

Local evidence:

- `src/modules/mcp-server/mcp-protocol-types.ts` defines
  `McpElicitationInputRequest` with only `mode: "form"`.
- `src/modules/mcp-server/mcp-mrtr.ts` decodes every accepted elicitation
  response as requiring a `content` object.
- `src/core/mcp/client.ts` and `src/core/mcp/operator-input.ts` accept generic
  remote input requests but still validate every accepted input response as
  content-bearing form data.
- `activeClientSupportsElicitation` currently checks only for an object-valued
  `elicitation` capability, not mode-level support.
- Completed tasks already cover MRTR request association, optional
  `input_required` fields, prompt/resource/tool result fidelity, and required
  prompt arguments; none owns URL-mode elicitation.

## Initiative

MCP protocol fidelity: KOTA should interoperate with current draft MCP peers
without inventing a second interaction surface or letting sensitive
third-party credentials pass through form elicitation.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Focused MCP client/operator-input tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/operator-input.test.ts`.
- Test fixtures prove URL-mode `input_required` requests round-trip via MRTR
  without content-bearing form responses, while form-mode validation remains
  strict.

## Completion Evidence

- `pnpm test src/modules/mcp-server/mcp-protocol-types.test.ts src/core/mcp/client.test.ts src/core/mcp/operator-input.test.ts src/core/mcp/manager.test.ts src/modules/mcp-server/server.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm validate-tasks` passed after staging the task move.
