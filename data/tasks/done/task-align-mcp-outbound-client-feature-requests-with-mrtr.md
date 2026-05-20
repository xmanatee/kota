---
id: task-align-mcp-outbound-client-feature-requests-with-mrtr
title: Align MCP outbound client-feature requests with MRTR
status: done
priority: p2
area: modules
summary: Replace KOTA MCP server standalone roots and legacy elicitation client requests with draft MRTR input_required flows, preserving explicit legacy compatibility only where intentional.
created_at: 2026-05-20T12:25:38Z
updated_at: 2026-05-20T12:44:36Z
---

## Problem

KOTA's MCP server now has draft discovery and per-request metadata, but some
outbound client-feature behavior still follows the old stateful,
server-initiated request model:

- `src/modules/mcp-server/mcp-handlers-initialize.ts` sends `roots/list`
  immediately after initialization when the client advertises roots, stores the
  response in connection state, and re-sends `roots/list` on
  `notifications/roots/list_changed`.
- `src/modules/mcp-server/mcp-handlers-elicitation.ts` still sends the legacy
  `sampling/elicit` request directly to clients.
- Draft `confirm` tool calls already use `resultType: "input_required"` with
  `elicitation/create`, but that shape is local to tools and does not yet own
  roots or remove the legacy standalone request paths from draft operation.

The current MCP draft says `roots/list`, `sampling/createMessage`, and
`elicitation/create` are client-feature requests that servers send through the
MRTR `InputRequiredResult` pattern on supported originating requests. Standalone
server-initiated requests are not supported. Keeping KOTA's old direct roots
and elicitation paths makes draft support look current while still depending on
a transport behavior current clients are no longer required to handle.

## Desired Outcome

KOTA's MCP server has one draft-compatible outbound client-feature mechanism:

- Draft `roots/list`, `elicitation/create`, and any future server-requested
  `sampling/createMessage` use a shared MRTR `InputRequiredResult` path with
  typed `inputRequests`, `inputResponses`, and opaque `requestState`.
- The server never emits standalone draft `roots/list`, `sampling/createMessage`,
  or `elicitation/create` JSON-RPC requests after initialize, after
  `notifications/roots/list_changed`, or from a side channel.
- Roots that affect request handling are resolved from the current request's
  client capabilities and MRTR retry payload, or else fall back explicitly to
  the configured project directory. No draft path relies on cached roots from a
  prior request.
- The existing legacy `2024-11-05` compatibility behavior is either kept behind
  a clearly named legacy branch with focused tests, or removed with an explicit
  compatibility decision in the task evidence.
- Existing draft tool-call input-required behavior for `confirm` is preserved
  and shares the same typed MRTR decoder instead of growing a separate protocol
  shape.

## Constraints

- Keep the work inside `src/modules/mcp-server/` unless a truly shared protocol
  primitive is needed. Do not import first-party MCP server helpers into
  `src/core/mcp/`.
- Treat MRTR request state as attacker-controlled on retry. If it carries
  anything that influences authorization, target method, or request behavior,
  protect or validate it instead of trusting client echo.
- Do not reintroduce a connection-level draft cache for roots, sampling, or
  elicitation capability decisions. Draft capability facts come from
  per-request `_meta.io.modelcontextprotocol/clientCapabilities`.
- Do not add a prose catalog of every MCP payload to docs. Exact protocol
  shapes belong in source types and focused tests.
- Preserve legacy clients only through explicit compatibility branches named
  as legacy, not by silently applying legacy behavior to draft requests.

## Done When

- A draft client declaring `roots` receives a `tools/call`, `resources/read`, or
  `prompts/get` `input_required` response containing a `roots/list` request
  when KOTA needs roots, and the retry with `inputResponses` completes the
  original request.
- No draft initialization test observes a standalone outbound `roots/list`
  request after `initialize`, and no draft root-change notification causes a
  standalone outbound re-fetch.
- Draft confirm/elicitation tests prove KOTA emits `elicitation/create` only as
  an `input_required` result on the originating `tools/call`, including reject
  and cancel responses, and no draft path sends `sampling/elicit`.
- Any remaining `sampling/createMessage` server endpoint is proven to be legacy
  compatibility only, or is renamed/removed from the draft surface with tests.
- Malformed, missing, mismatched, or cross-method `requestState` and
  `inputResponses` payloads fail loudly at the MCP boundary.
- Existing MCP server tests for discovery, per-request metadata, tools,
  resources, prompts, completion, resource subscriptions, and legacy
  initialization still pass.

## Source / Intent

Explorer run `2026-05-20T12-25-38-052Z-explorer-rq3owf` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align MCP outbound client-feature requests with MRTR" --state ready --area modules --priority p2 --summary "Replace KOTA MCP server standalone roots and legacy elicitation client requests with draft MRTR input_required flows, preserving explicit legacy compatibility only where intentional."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/basic/utilities/mrtr`
  documents MRTR and says server-to-client requests such as `roots/list`,
  `sampling/createMessage`, and `elicitation/create` must use
  `InputRequiredResult`; the previous standalone request pattern is no longer
  supported.
- `https://modelcontextprotocol.io/specification/draft/client/roots` documents
  roots as a deprecated client feature in `DRAFT-2026-v1`, with roots requested
  via `InputRequiredResult` during an originating request.
- `https://modelcontextprotocol.io/specification/draft/client/elicitation`
  documents `elicitation/create` as an `InputRequiredResult` request and adds
  form/url modes plus per-request client capability checks.
- `https://modelcontextprotocol.io/specification/draft/client/sampling`
  documents `sampling/createMessage` as a client feature requested through
  `InputRequiredResult`, not as a draft server endpoint.

Local evidence:

- `src/modules/mcp-server/mcp-handlers-initialize.ts` still sends standalone
  `roots/list` requests after initialize and on root-list-change notifications.
- `src/modules/mcp-server/mcp-handlers-elicitation.ts` still sends
  `sampling/elicit` directly for the legacy elicitation path.
- `src/modules/mcp-server/mcp-handlers-tools.ts` already has a draft
  `resultType: "input_required"` branch for `confirm`, proving the right
  protocol family is present but not generalized across outbound
  client-feature requests.
- Completed MCP tasks cover draft discovery/per-request metadata, resource
  subscriptions/listChanged, prompt required-argument validation, tool result
  variants, output schemas, and `x-mcp-header`; none owns removal of
  standalone outbound client-feature requests from the draft server path.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should implement the
current draft request lifecycle rather than layering draft feature details on
top of legacy server-initiated client requests.

## Acceptance Evidence

- Focused MCP server protocol tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Test fixtures show a draft request getting an MRTR `roots/list` or
  `elicitation/create` response, retrying with `inputResponses`, and completing
  without any standalone server-to-client JSON-RPC request.
- A regression assertion proves draft initialize and
  `notifications/roots/list_changed` do not enqueue outbound `roots/list`.
