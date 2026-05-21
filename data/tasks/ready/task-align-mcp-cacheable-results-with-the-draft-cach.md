---
id: task-align-mcp-cacheable-results-with-the-draft-cach
title: Align MCP cacheable results with the draft caching model
status: ready
priority: p2
area: modules
summary: Add draft ttlMs/cacheScope cache hints to KOTA's first-party MCP list/read results and preserve remote MCP cache hints in the client runtime without adding a parallel cache registry.
created_at: 2026-05-21T23:48:20Z
updated_at: 2026-05-21T23:48:20Z
---

## Problem

KOTA has been closing current-draft MCP gaps across discovery, tools, resources,
prompts, progress, tasks, MRTR, authorization, and Streamable HTTP. The draft
caching utility is still uncovered: first-party MCP list/read responses do not
include `ttlMs` or `cacheScope`, and the external MCP client decoders do not
preserve those fields from remote servers.

That leaves two protocol problems:

- KOTA's first-party MCP server returns draft list/read results that omit
  cacheability hints the current draft requires.
- KOTA's MCP client cannot distinguish immediately stale private data from
  reusable public catalogs, so future refresh behavior has to guess instead of
  relying on typed protocol facts.

## Desired Outcome

KOTA treats MCP cacheability as a typed protocol fact at the MCP boundary.
First-party server results include explicit cache hints, and remote client
results decode and expose those hints so the manager can avoid unnecessary
refetching without inventing a second cache registry.

The first slice should make cache semantics visible and conservative:

- First-party `tools/list`, `prompts/list`, `resources/list`,
  `resources/templates/list`, and `resources/read` return `ttlMs` and
  `cacheScope` values appropriate to the data they expose.
- Remote MCP client decoders preserve `ttlMs` and `cacheScope` for those same
  result kinds.
- Manager-level refresh behavior honors positive TTL only for the matching
  server, operation, cursor, and authorization context; list-changed
  notifications invalidate cached pages immediately.
- Missing cache hints from older remote servers normalize to explicit
  immediately-stale private/public behavior at the boundary rather than
  flowing as absent internal state.

## Constraints

- Keep first-party server changes in `src/modules/mcp-server/` and external
  client changes in `src/core/mcp/`; do not pull module-owned server helpers
  into core.
- Do not add a durable cache database or parallel MCP registry. In-memory
  request/result freshness is enough for this protocol slice.
- Treat `cacheScope: "public"` as an explicit sharing statement from the MCP
  server, not as an authorization bypass. KOTA must still enforce per-server
  access controls and must not share private cached responses across
  authorization contexts.
- Keep exact wire fields and validation in source types and focused tests, not
  in durable docs.
- Do not add automatic polling from TTL expiry. Re-fetch when a caller asks for
  stale data or when a list-changed notification invalidates the cached page.

## Done When

- First-party MCP server tests assert `ttlMs` and `cacheScope` on
  `tools/list`, `prompts/list`, `resources/list`,
  `resources/templates/list`, and `resources/read`.
- External MCP client tests decode valid cache hints, reject malformed
  `cacheScope`, and normalize missing or negative `ttlMs` according to the
  external-boundary contract.
- MCP manager tests show repeated resource/prompt list calls reuse a still-
  fresh remote page and re-fetch after TTL expiry or after a matching
  list-changed notification.
- Remote operation outputs surface cache metadata in structured content or
  `_meta` so callers can inspect why a response was reused or refreshed.
- Existing MCP server/client/manager behavior remains green, including
  pagination, Streamable HTTP request metadata, list-changed notifications,
  and input-required retry flows.

## Source / Intent

Explorer run `2026-05-21T23-45-52-230Z-explorer-xubjfp` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align MCP cacheable results with the draft caching model" --state ready --area modules --priority p2 --summary "Add draft ttlMs/cacheScope cache hints to KOTA's first-party MCP list/read results and preserve remote MCP cache hints in the client runtime without adding a parallel cache registry."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/utilities/caching`
  describes cache hints for `tools/list`, `prompts/list`, `resources/list`,
  `resources/templates/list`, and `resources/read`; the fields are `ttlMs`
  and `cacheScope`, and list-changed notifications invalidate fresh cached
  results.

Local evidence:

- `rg "ttlMs|cacheScope" src/core/mcp src/modules/mcp-server data/tasks`
  found no existing open or implemented cache-hint support.
- `src/modules/mcp-server/mcp-handlers-tools.ts`,
  `src/modules/mcp-server/mcp-handlers-resources.ts`, and
  `src/modules/mcp-server/mcp-handlers-prompts.ts` return list/read results
  without cache hints.
- `src/core/mcp/client.ts` decodes remote tool/resource/prompt result pages
  without cache-hint fields.
- `src/core/mcp/manager.ts` already receives list-changed notifications for
  tools, resources, and prompts, which is the right invalidation hook for a
  conservative in-memory cache.

## Initiative

MCP protocol fidelity: KOTA should keep its first-party server and external
client aligned with current MCP semantics without turning protocol metadata
into a second capability system.

## Acceptance Evidence

- Focused MCP server tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Focused MCP client and manager tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A regression fixture or test demonstrates TTL reuse, TTL expiry refresh, and
  list-changed invalidation for at least one remote resource or prompt list.
