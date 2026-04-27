---
id: task-add-daemon-http-apihistorysearch-semantic-search-r
title: Add daemon HTTP /api/history/search semantic search route consuming HistoryProvider.semanticSearch
status: done
priority: p2
area: modules
summary: Add a /api/history/search route mirroring /api/memory/search — discriminated { ok: true, conversations } | { ok: false, reason: 'semantic_unavailable' } envelope, fed by HistoryProvider.semanticSearch when ?semantic=true and supportsSemanticSearch is true — so operator clients can fan out conversation recall the same way memory and knowledge already are.
created_at: 2026-04-27T03:01:37.975Z
updated_at: 2026-04-27T03:11:47.189Z
---

## Problem

The `memory` and `knowledge` modules each expose a daemon HTTP search
route — `/api/memory/search` and `/api/knowledge/search` — that returns
the discriminated envelope `{ ok: true, entries } | { ok: false, reason:
"semantic_unavailable" }` and is consumed end-to-end by Telegram, the
CLI, the web client, the macOS menu bar, and the mobile client. The
just-completed `task-add-mobile-memoryscreen-consuming-searchmemory`
closed the memory fan-out across all six surfaces.

The conversation history surface has no equivalent search route. The
`history` module already exposes `GET /api/history` (keyword filter on
the index) and `GET /api/history/<id>`, but no semantic search route
that returns the same discriminated envelope. The `history-semantic`
module already implements `HistoryProvider.semanticSearch(query, limit,
filter)` and `HistoryProvider.supportsSemanticSearch()` against a
sidecar `.embeddings.json` index, so the provider seam is in place;
what is missing is the daemon HTTP surface that exposes it.

Without that route, operators on the web/macOS/mobile clients cannot
semantically recall prior conversations, and Telegram cannot expose
`/history <query>` symmetric to `/memory` and `/knowledge`. The agent
side already has `conversation_recall`, but the operator side falls
back to keyword filtering on titles and message counts.

## Desired Outcome

A new `GET /api/history/search?q=&semantic=true&limit=20[&cwd=&source=]`
route lives in `src/modules/history/routes.ts` next to the existing
list/get/delete handlers. It calls the configured `HistoryProvider`'s
`semanticSearch` (when `?semantic=true` and `supportsSemanticSearch()`)
and returns:

- `{ ok: true, conversations: ConversationRecord[] }` for non-empty
  and empty results alike (empty array is still `ok: true`).
- `{ ok: false, reason: "semantic_unavailable" }` when `?semantic=true`
  is requested but the provider does not support semantic search,
  matching the memory/knowledge envelope exactly. No silent degrade to
  keyword search.
- The keyword path (semantic omitted or `?semantic=false`) returns
  `{ ok: true, conversations }` driven by the existing keyword search
  in `getHistory().list({ search, limit, cwd, source })`.

The CLI's `ctx.client.history` namespace gains a `search` method that
calls the new route through the same daemon-up / daemon-down branch
the existing `listHistory`/`getHistory` calls already follow.

## Constraints

- Reuse `HistoryProvider.semanticSearch` and `supportsSemanticSearch`
  from `src/core/modules/provider-types.ts`. Do not extend the
  provider interface or add a parallel semantic seam.
- Mirror the `/api/memory/search` envelope shape exactly. The
  discriminator field name (`ok`), the `reason` value
  (`"semantic_unavailable"`), and the malformed/HTTP-error handling on
  the client side must match so downstream clients can share the
  pattern without per-surface forks.
- Add the route through the existing `historyRoutes()` registration in
  `src/modules/history/routes.ts`. Do not add a sibling routes file or
  a parallel registration path.
- Preserve the existing keyword-search path on `GET /api/history` —
  this task adds a new route, it does not rewrite the existing one.
- Keep the `.kota/` direct-read guard intact: the route reads through
  `getHistoryProvider()`, never through the filesystem directly.
- Add a typed mirror to the `KotaClient.history` namespace
  (`src/core/server/kota-client.ts`) and the `DaemonControlClient`
  (`src/core/server/daemon-client.ts`), matching the
  `searchMemory`/`searchKnowledge` shapes one-to-one.
- Output continues to flow through `src/modules/rendering` for the
  CLI; this task only ships the route + namespace types + daemon-side
  wire code, not the CLI subcommand (that lives in the follow-up).
- No legacy or compatibility surface. The discriminated envelope is
  the only response shape for the new route.

## Done When

- `GET /api/history/search?q=&semantic=true&limit=` returns the
  discriminated `{ ok: true, conversations: ConversationRecord[] } | {
  ok: false, reason: "semantic_unavailable" }` envelope, fed by
  `HistoryProvider.semanticSearch` when semantic is requested and
  available, and by the existing keyword search otherwise.
- The `KotaClient.history` namespace exposes a typed `search(query,
  options)` method returning the same discriminated envelope; the
  daemon-side `DaemonControlClient` implements the wire call.
- A new `routes.test.ts`-style test covers the success / empty-query /
  semantic-unavailable / malformed-response branches against an
  in-memory `HistoryProvider` stub, mirroring the
  `src/modules/memory/routes.test.ts` coverage.
- A `client.test.ts`-style test covers
  `DaemonControlClient.searchHistory` / `KotaClient.history.search` for
  success, semantic-unavailable, unknown-reason, malformed-response,
  and HTTP-error branches.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The just-completed `task-add-mobile-memoryscreen-consuming-searchmemory`
(commit `6843b9f4`) closed the memory fan-out across Telegram, CLI,
daemon HTTP, web, macOS, and mobile, matching the digest, attention,
and knowledge seams' multi-client parity. The conversation history
surface — recall, the operator-facing twin of the agent's
`conversation_recall` tool — is the next surface in the same family.
This task lands the daemon-side foundation that the CLI, Telegram,
web, macOS, and mobile fan-outs will all consume.

## Initiative

Conversation/recall seam fan-out — match the memory/knowledge multi-
surface client coverage so the on-demand semantic conversation search
the daemon can serve is reachable from every operator surface, the
same way the digest, attention, knowledge, and memory seams already
are.

## Acceptance Evidence

- New `routes.test.ts` test output showing the four envelope branches
  pass against an in-memory `HistoryProvider` stub.
- New `DaemonControlClient.searchHistory` / `KotaClient.history.search`
  test output showing parity with the `searchMemory`/`searchKnowledge`
  branch coverage.
- A short rendered transcript showing `curl
  'http://127.0.0.1:<port>/api/history/search?q=...&semantic=true'`
  returning the discriminated envelope on a daemon configured with the
  `history-semantic` provider, and a second transcript showing the
  same call returning `{ ok: false, reason: "semantic_unavailable" }`
  on a daemon configured with the default keyword-only history
  provider.
