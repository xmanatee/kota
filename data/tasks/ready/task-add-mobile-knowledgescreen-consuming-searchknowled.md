---
id: task-add-mobile-knowledgescreen-consuming-searchknowled
title: Add mobile KnowledgeScreen consuming searchKnowledge
status: ready
priority: p2
area: client
summary: Add a KnowledgeScreen in the mobile client (mirroring DigestScreen and AttentionScreen) that calls GET /api/knowledge/search through the mobile daemon HTTP client, exposes search query state on DaemonContext, and renders the top-entry lines plus the semantic-unavailable branch one-to-one with the four other knowledge surfaces — completing the knowledge fan-out across CLI, daemon HTTP, web, Telegram, macOS, and mobile.
created_at: 2026-04-27T00:07:56.326Z
updated_at: 2026-04-27T00:07:56.326Z
---

## Problem

The `knowledge` module's operator-pull surface is now exposed on five
clients:

- `kota knowledge {list, search, show, ...}` CLI
  (`src/modules/knowledge/cli.ts`).
- Daemon HTTP `GET /api/knowledge` and `GET /api/knowledge/search`
  (`src/modules/knowledge/routes.ts`); the search route returns
  `{ ok: true, entries: KnowledgeEntry[] } | { ok: false, reason:
  "semantic_unavailable" }` so callers do not silently degrade to keyword
  search behind the operator's back.
- Embedded web `KnowledgePanel`
  (`clients/web/src/components/sidebar/KnowledgePanel.tsx`).
- Telegram `/knowledge <query>` command
  (`src/modules/telegram/status-poll.ts`,
  `src/modules/telegram/AGENTS.md`), rendered via the shared
  `renderKnowledgeSearchPlain` helper in `src/modules/knowledge/render.ts`.
- macOS menu bar `KnowledgeView`
  (`clients/macos/Sources/KotaMenuBar/KnowledgeView.swift`) consuming
  `DaemonClient.searchKnowledge(query:limit:)` with a typed
  `KnowledgeSearchResponse` mirror.

The mobile client is the last surface in the established cadence. It
already exposes the digest and attention bodies through
`clients/mobile/src/screens/DigestScreen.tsx` and
`clients/mobile/src/screens/AttentionScreen.tsx`, the navigation map
(`clients/mobile/src/navigation/index.tsx`) registers the corresponding
screens, and `clients/mobile/src/context/DaemonContext.tsx` exposes
`refreshDigest`, `refreshAttention`, and the matching reducer state.
There is no equivalent `KnowledgeScreen`, no `searchKnowledge*` state on
`DaemonContext`, and no `searchKnowledge()` call against the daemon
route the other surfaces consume — so an operator on a phone has no way
to query the project knowledge store without context-switching to a
terminal, browser, Telegram chat, or the macOS menu bar.

## Desired Outcome

The mobile client gains a KnowledgeScreen — a navigation-mounted screen
mirroring `DigestScreen` and `AttentionScreen` shape — with a search
input, a "Search" affordance, and a result list. It calls
`GET /api/knowledge/search?q=&semantic=true&limit=10` through the
mobile daemon HTTP client, exposes the query, last result, in-flight,
and last-error state on `DaemonContext` under
`knowledgeQuery`/`knowledgeResult`/`knowledgeLoading`/`knowledgeError`
with a `searchKnowledge(query)` method, and renders the same top-entry
line shape (id, type, status, title) the shared
`renderKnowledgeSearchPlain` helper and the macOS `KnowledgeView`
already emit.

The four operator-visible branches surface one-to-one with the daemon
contract:

- Per-entry rendered lines for non-empty results.
- A fixed empty-result body ("No matching knowledge entries.") so the
  operator can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

## Constraints

- Build on the existing `DaemonContext`, navigation map, and screen
  composition; do not add a parallel state container, navigation stack,
  or HTTP client just for knowledge.
- Reuse the same daemon HTTP route (`GET /api/knowledge/search`) the
  web/CLI/Telegram/macOS surfaces already consume. Do not introduce a
  second knowledge seam, response model, or rendering helper on the
  mobile side.
- Mirror `DaemonClient.searchKnowledge` from the macOS client: the
  mobile `getKnowledge` / `searchKnowledge` method must return the same
  discriminated `{ ok: true, entries } | { ok: false, reason:
  "semantic_unavailable" }` shape and reject other shapes loudly.
- Match DigestScreen / AttentionScreen interaction discipline:
  pull-to-refresh on the result list (re-runs the last query), explicit
  loading / error / empty / quiet states, no eager fetch when the
  daemon is offline.
- Keep KnowledgeScreen visually consistent with DigestScreen and
  AttentionScreen so the three pull-surfaces feel like one family.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Do not duplicate the per-entry line shape. Either share the existing
  `renderKnowledgeSearchPlain` helper across the language boundary by
  re-deriving the same line format from the typed entries on the mobile
  side, or factor a small typed renderer that both surfaces can call —
  whichever produces fewer moving parts. No third format.

## Done When

- `clients/mobile/src/screens/KnowledgeScreen.tsx` renders the
  KnowledgeScreen, registered in the navigation map and reachable from
  the existing menu/tab structure alongside DigestScreen and
  AttentionScreen.
- `DaemonContext` exposes `knowledgeQuery`, `knowledgeResult`,
  `knowledgeLoading`, `knowledgeError`, and `searchKnowledge(query)`,
  matching the digest/attention shape, with reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- The mobile `DaemonClient` adds a `searchKnowledge(query, limit)` call
  against the daemon HTTP route, returning the same discriminated
  `{ ok: true, entries: KnowledgeEntry[] } | { ok: false, reason:
  "semantic_unavailable" }` envelope, with a typed mirror in
  `clients/mobile/src/types.ts`.
- `clients/mobile/src/__tests__/KnowledgeScreen.test.tsx` covers the
  populated-results state, the empty-results state, the
  empty-query usage hint, the semantic-unavailable branch, and the
  error state.
- The shared `renderKnowledgeSearchPlain` line shape (id, type, status,
  title) is preserved one-to-one on the mobile surface, verified by a
  rendered-output sample assertion in the screen test.
- The mobile test command and the knowledge module's tests both pass
  cleanly; no other knowledge-fan-out tests regress.

## Source / Intent

The just-completed macOS KnowledgeView task
(`task-add-macos-menu-bar-knowledgeview-consuming-daemonc`,
commit `5d66bffd`) and its prerequisite daemon-client subtask
(`task-add-macos-daemonclientsearchknowledge-with-discrim`,
commit `b363a54a`) extended the knowledge fan-out from Telegram → CLI →
daemon HTTP → web to the always-visible native operator surface. The
macOS task description and the prior daily-digest / attention seam fan-
outs explicitly establish the cadence Telegram → CLI → daemon HTTP →
web → macOS → mobile; the mobile screen is the remaining step. With
this task done, the knowledge surface reaches the same six-client
parity the digest and attention seams already have, and an operator
on a phone gains direct access to the project knowledge store.

## Initiative

Knowledge seam fan-out — match the digest and attention seams' multi-
surface client coverage so the on-demand semantic search the daemon
already serves is reachable from every operator surface, including the
mobile screen, without context-switching to another client.

## Acceptance Evidence

- Mobile test command output showing the new KnowledgeScreen reducer,
  navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile KnowledgeScreen showing the
  populated-results, empty-results, empty-query-hint, and
  semantic-unavailable states driven by the same daemon route.
- A short rendered-output sample (line shape) from the KnowledgeScreen
  next to the equivalent `kota knowledge search` CLI output and the
  Telegram `/knowledge` body proving line-shape parity.
