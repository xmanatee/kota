---
id: task-warn-on-deprecated-mcp-capability-negotiation
title: Warn on deprecated MCP capability negotiation
status: ready
priority: p2
area: modules
summary: Emit focused diagnostics when KOTA negotiates MCP roots, sampling, or logging support so deprecated protocol features remain compatibility-only and visible to operators.
created_at: 2026-05-22T03:19:21Z
updated_at: 2026-05-22T03:19:21Z
---

## Problem

KOTA's first-party and remote MCP surfaces now support several current draft
features, including roots, sampling, and request-scoped logging. Those features
remain supported during the MCP deprecation window, but SEP-2577 has now
marked them as deprecated core protocol features and recommends that
implementations warn when deprecated capabilities are negotiated.

Local code treats the deprecated status as implementation context in task specs
and compatibility branches, but the runtime does not surface that fact when a
client or server actually negotiates one of these features. Operators can
therefore see successful MCP initialization or draft request handling without
any visible signal that KOTA is exercising a compatibility-only protocol path.

## Desired Outcome

Deprecated MCP feature use is visible but not noisy. When KOTA negotiates or
receives a declared capability for roots, sampling, or logging, it emits a
focused local diagnostic that names the feature, peer, protocol version, and
compatibility posture. The warning must not change wire-level behavior during
the deprecation window and must not spam repeated warnings for the same peer
and feature within a single MCP session.

## Constraints

- Keep first-party server changes under `src/modules/mcp-server/` and remote
  client/manager changes under `src/core/mcp/`.
- Do not remove roots, sampling, or logging support in this task; the current
  draft still requires implementations that support the features to handle
  them correctly during the deprecation period.
- Do not emit protocol `notifications/message` unless the request explicitly
  asked for request-scoped logging. These warnings are operator diagnostics,
  not a second use of the deprecated logging feature.
- Keep exact capability names, protocol version checks, and warning wording in
  source types and focused tests, not durable docs.

## Done When

- The first-party MCP server warns once per session when legacy or draft
  initialization/discovery negotiates deprecated roots, sampling, or logging
  support.
- Draft per-request metadata handling warns when a request declares deprecated
  roots or sampling client capabilities, or asks for deprecated
  `io.modelcontextprotocol/logLevel` handling.
- The remote MCP client/manager warns when a connected server advertises the
  deprecated logging capability or returns deprecated client-feature input
  requests for roots or sampling.
- Tests prove warnings are deduplicated, include the peer/protocol/feature
  context, and do not alter successful request results.
- Existing MCP server, Streamable HTTP, client, and manager tests remain green.

## Source / Intent

Explorer run `2026-05-22T03-17-00-605Z-explorer-chnhnp` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Warn when deprecated MCP roots sampling or logging capabilities are negotiated" --state ready --area modules --priority p2 --summary "Emit focused diagnostics when KOTA negotiates MCP roots, sampling, or logging support so deprecated protocol features remain compatibility-only and visible to operators."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging`
  is final, deprecates roots, sampling, and logging, preserves wire-level
  behavior during the deprecation period, and says implementations should emit
  warnings when deprecated capabilities are negotiated.
- `https://modelcontextprotocol.io/specification/draft/basic/index` still
  lists per-request protocol metadata, including optional
  `io.modelcontextprotocol/logLevel`, and requires servers to honor declared
  client capabilities rather than relying on undeclared ones.

Local evidence:

- `src/modules/mcp-server/mcp-protocol-types.ts` defines
  `MCP_META_LOG_LEVEL_KEY`, roots, sampling, and logging protocol types but has
  no deprecation warning helper or per-feature negotiation state.
- `src/modules/mcp-server/mcp-handlers-initialize.ts` builds draft logging
  capabilities and legacy roots/sampling capabilities without warning.
- `src/core/mcp/client.ts` has warning paths for malformed remote tool
  definitions and progress noise, but repository search found no warning path
  for deprecated MCP capability negotiation.
- Completed MCP tasks already cover the strict behavior of roots, sampling,
  logging, MRTR, and request metadata; none covers SEP-2577's operator-visible
  deprecation warning recommendation.

## Initiative

MCP protocol fidelity: KOTA should keep supporting deprecated features during
the official transition window while making compatibility-only protocol use
visible enough for operators and future cleanup work.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/streamable-http.test.ts`.
- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Test output or fixtures demonstrate one warning per deprecated feature per
  peer/session and unchanged successful MCP responses.
