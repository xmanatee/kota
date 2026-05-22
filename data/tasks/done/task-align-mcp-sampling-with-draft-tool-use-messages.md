---
id: task-align-mcp-sampling-with-draft-tool-use-messages
title: Align MCP sampling with draft tool-use messages
status: done
priority: p2
area: modules
summary: Implement draft MCP sampling/createMessage as a typed MRTR client-feature path with request-scoped tools, tool-use and tool-result message validation, and explicit legacy sampling compatibility.
created_at: 2026-05-22T02:10:59Z
updated_at: 2026-05-22T02:30:32Z
---

## Problem

KOTA has recent draft MCP MRTR support for roots and elicitation, and it keeps
the old `sampling/createMessage` server endpoint as legacy-only compatibility.
The current MCP draft sampling page now gives `sampling/createMessage` a richer
client-feature shape: servers can request sampling through MRTR, include
request-scoped tool definitions, receive assistant `tool_use` blocks, and send
follow-up sampling messages containing only matching `tool_result` blocks.

KOTA's current protocol surface does not model that shape strictly. The
first-party MCP server type for sampling input requests is just `params:
KotaJsonObject`; the remote MCP client accepts unknown input request methods
but validates all input responses like elicitation responses; and the legacy
sampling handler flattens messages to text, ignoring draft tool-use messages,
tool choice, audio/image content, model preferences, context inclusion, and
tool-result balance rules.

Without a typed sampling boundary, a draft MCP peer that uses sampling tool
loops will either be rejected through generic input-response validation or
silently lose message structure at the compatibility endpoint.

## Desired Outcome

KOTA has one explicit draft sampling protocol boundary:

- Draft `sampling/createMessage` is represented as a typed MRTR input request
  and response, not as an unstructured JSON object.
- Remote MCP input-required routing can distinguish sampling responses from
  elicitation and roots responses, and can either execute a configured,
  operator-approved sampling bridge or return a precise diagnostic when no
  bridge is available.
- Sampling message decoding preserves text, image, audio, `tool_use`, and
  `tool_result` blocks as typed data at the MCP boundary.
- Request-scoped `tools` and `toolChoice` are decoded and validated without
  adding those tools to KOTA's global tool registry.
- Tool-result messages are validated against the draft balance rule: a user
  message containing tool results contains only tool results, and every prior
  assistant tool-use id is answered before normal conversation continues.
- The existing legacy `sampling/createMessage` endpoint remains deliberately
  legacy-only or is narrowed further with focused tests; it must not pretend to
  be the current draft sampling path.

## Constraints

- Keep first-party server work under `src/modules/mcp-server/` and remote MCP
  client/manager work under `src/core/mcp/`.
- Do not add a second tool registry for request-scoped sampling tools. Treat
  them as message-local provider tool definitions.
- Do not auto-run remote sampling requests by default. If no trusted sampling
  bridge exists, fail loudly with an operator-facing diagnostic rather than
  silently consuming model budget.
- Keep exact MCP method names, content block variants, and error payloads in
  source types and focused tests, not in durable docs.
- Preserve existing MRTR request-state integrity checks and legacy MCP tests.

## Done When

- MCP protocol types in the first-party server and remote client represent
  `sampling/createMessage` params and responses with typed content blocks,
  model preferences, `tools`, `toolChoice`, `includeContext`, and stop reasons.
- Remote MCP `input_required` results containing sampling requests no longer
  pass through elicitation-only input-response validation; they either route to
  a configured sampling bridge or return an explicit unavailable diagnostic.
- Tests prove request-scoped sampling tools are accepted without mutating the
  global KOTA tool registry.
- Tests reject malformed sampling conversations: mixed text plus tool results
  in one user message, missing tool results for assistant tool-use ids, invalid
  tool-choice modes, and unsupported content block shapes.
- Tests prove the legacy server endpoint is still hidden from draft requests
  and that its compatibility behavior is intentionally limited.
- Existing MCP server, client, manager, MRTR, elicitation, roots, and task
  lifecycle tests remain green.

## Source / Intent

Explorer run `2026-05-22T02-08-56-340Z-explorer-ysvyw8` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align MCP sampling with draft tool-use messages" --state ready --area modules --priority p2 --summary "Implement draft MCP sampling/createMessage as an MRTR client-feature request with typed tool-use messages, request-scoped tool definitions, tool-result balance checks, and legacy sampling kept explicit."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/client/sampling`
  describes sampling as a deprecated-in-draft client feature requested through
  `InputRequiredResult`, with optional request-scoped tools, tool choice,
  image/audio content, model preferences, context inclusion, and tool-use /
  tool-result balance constraints.
- `https://modelcontextprotocol.io/specification/draft/client/roots` and
  `https://modelcontextprotocol.io/specification/draft/basic/lifecycle`
  reinforce the same draft posture: server-to-client requests must be tied to
  originating requests, while protocol and capability facts are supplied per
  request rather than inferred from connection state.

Local evidence:

- `src/modules/mcp-server/mcp-protocol-types.ts` defines
  `McpSamplingInputRequest` as `params: KotaJsonObject`, unlike the typed
  elicitation and roots request variants beside it.
- `src/core/mcp/client.ts` decodes arbitrary input request methods but
  validates input responses as elicitation-style `{ action, content }`
  responses, so sampling input responses have no typed path.
- `src/modules/mcp-server/mcp-handlers-sampling.ts` handles
  `sampling/createMessage` only for the legacy protocol and flattens message
  content to text before calling the model client.
- Completed tasks already cover draft discovery, per-request metadata, MRTR,
  roots, elicitation, completion, resources, tools, and MCP task lifecycle;
  none covers draft sampling tool-use message fidelity.

## Initiative

MCP protocol fidelity: KOTA should interoperate with current draft MCP peers
through strict typed protocol boundaries instead of carrying unstructured
sampling payloads or legacy endpoint semantics forward.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Test fixtures show a remote draft `input_required` sampling request with
  request-scoped tools being routed or rejected through the explicit sampling
  contract, not through elicitation-only validation.
