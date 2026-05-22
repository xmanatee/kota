---
id: task-split-the-core-mcp-client-into-protocol-focused-si
title: Split the core MCP client into protocol-focused siblings
status: ready
priority: p2
area: core
summary: Break the oversized external MCP client into typed transport, authorization, protocol-decoding, and feature-operation siblings while preserving the core session-loop client contract.
created_at: 2026-05-22T09:55:15Z
updated_at: 2026-05-22T09:55:15Z
---

## Problem

`src/core/mcp/client.ts` is now 4,948 lines and concentrates nearly every
external MCP client concern in one core file: public protocol types, stdio
process transport, Streamable HTTP transport, SSE parsing, request-scoped
progress/log handling, `subscriptions/listen`, OAuth/PKCE authorization,
protected-resource metadata discovery, tool/header annotation validation,
resource/prompt decoders, sampling/MRTR decoders, cache hint normalization,
and the `McpClient` class itself.

That concentration makes each new MCP draft-alignment slice higher-risk than
it needs to be. The file has become the client-side version of the earlier
`mcp-server` monolith: a single edit surface where transport behavior,
authorization, feature-specific decoding, and request orchestration are hard to
review independently. The local `src/core/mcp/AGENTS.md` is still correct that
the client side belongs in core because the session loop consumes it directly;
the problem is the lack of protocol-focused seams inside that core boundary.

## Desired Outcome

`src/core/mcp/client.ts` becomes a thin public client/orchestrator that keeps
the stable `McpClient` contract and delegates owned concerns to sibling files
under `src/core/mcp/`.

The builder should split by real MCP client concerns rather than by arbitrary
line ranges. A good final shape is:

- transport adapters for stdio, Streamable HTTP JSON, and Streamable HTTP SSE
- OAuth / protected-resource / authorization challenge handling
- JSON-RPC message and request lifecycle helpers
- feature decoders for tools, resources, prompts, completion, sampling/MRTR,
  logging/progress, and cache hints
- tool-schema/header-annotation validation
- small shared protocol types where multiple siblings need the same shape

The exact file names are the builder's decision, but each new file should have
one reason to change and one dependency profile. The `McpClient` public API,
manager-facing exports, and current behavior remain unchanged.

## Constraints

- Keep the MCP client in `src/core/mcp/`; do not move it into a module or import
  `src/modules/mcp-server/*` helpers back into core.
- Preserve external behavior exactly: config validation, OAuth errors,
  protocol-version fallback, JSON-RPC error mapping, SSE final-response
  requirements, progress/log notification dispatch, list-change subscription
  behavior, cache metadata, tool result decoding, resource/prompt operations,
  and rejected-tool warning text must not drift.
- Do not add compatibility shims, alias files, deprecated re-exports, a
  handler registry, or a second MCP DSL. Use normal typed functions/classes and
  direct imports.
- Keep strict internal protocol validation. Malformed MCP responses should
  still fail loudly with the existing useful labels.
- Update `src/core/mcp/AGENTS.md` only if the split establishes a durable
  local convention for future MCP client feature work.
- Prefer a cohesive split over a partial extraction that leaves
  `client.ts` as a mostly unchanged monolith with a few helpers moved out.

## Done When

- `src/core/mcp/client.ts` is a thin orchestrator instead of a 4,948-line
  all-in-one implementation; target <= 500 lines.
- New sibling files are protocol-focused and stay small enough to review
  independently; no new production file under `src/core/mcp/` exceeds 500
  lines without a named reason in the task completion notes.
- Existing manager-facing imports still resolve from the canonical public
  surface the builder chooses; no duplicate alias surface remains.
- Focused MCP client and manager behavior is covered by the existing tests plus
  any new seam-level tests needed for extracted decoders or transports.
- `pnpm typecheck` and the lint gate pass.

## Source / Intent

Explorer run `2026-05-22T09-53-00-563Z-explorer-rferau` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Split the core MCP client into protocol-focused siblings" --state ready --area core --priority p2 --summary "Break the oversized external MCP client into typed transport, authorization, protocol-decoding, and feature-operation siblings while preserving the core session-loop client contract."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

Local evidence:

- `wc -l src/core/mcp/client.ts src/core/mcp/manager.ts` reports
  `client.ts` at 4,948 lines and `manager.ts` at 1,249 lines.
- `src/core/mcp/AGENTS.md` says the external MCP client and manager stay in
  core because the session loop and tool runner consume them directly.
- `rg` over `src/core/mcp/client.ts` shows one file owning public MCP types,
  transport config normalization, OAuth/PKCE helpers, protected-resource and
  authorization-server metadata decoders, cache hint decoding, feature decoders
  for tools/resources/prompts/sampling/MRTR, header annotation validation, and
  the `McpClient` class.
- No open ready/backlog/blocked task covers the core MCP client split.

## Initiative

Core runtime maintainability: the MCP client is a genuine session-loop
primitive, but draft MCP support is changing quickly. Splitting it into
protocol-focused siblings keeps the core boundary intact while making future
transport, authorization, and feature-alignment work reviewable without
re-reading one multi-thousand-line file.

## Acceptance Evidence

- A line-count snapshot captured under `.kota/runs/<run-id>/mcp-client-wc.txt`
  before and after the split, showing `client.ts` reduced to the target shape
  and the new sibling files within the named size bound.
- Focused MCP tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- `pnpm typecheck` transcript captured under `.kota/runs/<run-id>/typecheck.txt`.
- Lint or formatting transcript captured under `.kota/runs/<run-id>/lint.txt`.
