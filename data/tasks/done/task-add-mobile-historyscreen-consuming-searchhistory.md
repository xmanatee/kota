---
id: task-add-mobile-historyscreen-consuming-searchhistory
title: Add mobile HistoryScreen consuming searchHistory
status: done
priority: p2
area: client
summary: Add a HistoryScreen in the mobile client (mirroring KnowledgeScreen, MemoryScreen, DigestScreen, and AttentionScreen) that calls GET /api/history/search through the mobile daemon HTTP client, exposes search state on DaemonContext, and renders the same per-conversation line shape the four other history surfaces emit — completing the history fan-out across Telegram, daemon HTTP, CLI, macOS DaemonClient, macOS HistoryView, and mobile.
created_at: 2026-04-27T04:46:28.024Z
updated_at: 2026-04-27T04:56:04.668Z
---

## Problem

The `history` module's on-demand semantic search seam is now exposed
on five clients:

- `kota history search` CLI (`src/modules/history/cli-commands.ts`).
- Daemon HTTP `GET /api/history/search`
  (`src/modules/history/routes.ts`); the route returns
  `{ ok: true, conversations } | { ok: false, reason: "semantic_unavailable" }`
  so callers do not silently degrade to keyword search behind the
  operator's back.
- Telegram `/history <query>` command, rendered via the shared
  `renderHistorySearchPlain` helper in `src/modules/history/render.ts`.
- macOS `DaemonClient.searchHistory(query:limit:)` with a typed
  `HistorySearchResponse` mirror.
- macOS menu bar `HistoryView`
  (`clients/macos/Sources/KotaMenuBar/HistoryView.swift`).

The mobile client is the last surface in the established cadence
(Telegram → CLI → daemon HTTP → macOS → mobile). It already exposes
the digest, attention, knowledge, and memory bodies through
`clients/mobile/src/screens/DigestScreen.tsx`,
`clients/mobile/src/screens/AttentionScreen.tsx`,
`clients/mobile/src/screens/KnowledgeScreen.tsx`, and
`clients/mobile/src/screens/MemoryScreen.tsx`; the navigation map
(`clients/mobile/src/navigation/index.tsx`) registers each of those
screens, and `clients/mobile/src/context/DaemonContext.tsx` already
exposes `searchKnowledge` and `searchMemory` plus the matching
reducer state. There is no equivalent `HistoryScreen`, no
`searchHistory*` state on `DaemonContext`, and no `searchHistory()`
call against the daemon route the other four surfaces consume — so
an operator on a phone has no way to search project conversation
history without context-switching to a terminal, browser, Telegram
chat, or the macOS menu bar.

## Desired Outcome

The mobile client gains a HistoryScreen — a navigation-mounted
screen mirroring `MemoryScreen`, `KnowledgeScreen`, `DigestScreen`,
and `AttentionScreen` shape — with a search input, a "Search"
affordance, and a result list. It calls
`GET /api/history/search?q=&semantic=true&limit=10` through the
mobile daemon HTTP client, exposes the query, last result,
in-flight, and last-error state on `DaemonContext` under
`historyQuery`/`historyResult`/`historyLoading`/`historyError` with
a `searchHistory(query)` method, and renders the same
per-conversation line shape the shared `renderHistorySearchPlain`
helper and the macOS `HistoryView` already emit.

The four operator-visible branches surface one-to-one with the
daemon contract:

- Per-conversation rendered lines for non-empty results
  (id, updated date, message count, title — same shape as
  `renderHistorySearchPlain`).
- A fixed empty-result body ("No matching conversations.") so the
  operator can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

## Constraints

- Build on the existing `DaemonContext`, navigation map, and screen
  composition; do not add a parallel state container, navigation
  stack, or HTTP client just for history.
- Reuse the same daemon HTTP route (`GET /api/history/search`) the
  CLI / Telegram / macOS surfaces already consume. Do not introduce
  a second history seam, response model, or rendering helper on the
  mobile side.
- Mirror `DaemonClient.searchHistory` from the macOS client: the
  mobile `searchHistory` method must return the same discriminated
  `{ ok: true, conversations } | { ok: false, reason:
  "semantic_unavailable" }` shape and reject other shapes loudly,
  identical in structure to the existing mobile `searchKnowledge`
  and `searchMemory`.
- Match KnowledgeScreen / MemoryScreen / DigestScreen /
  AttentionScreen interaction discipline: pull-to-refresh on the
  result list (re-runs the last query), explicit loading / error /
  empty / quiet states, no eager fetch when the daemon is offline.
- Keep HistoryScreen visually consistent with the four sibling
  pull-surfaces so the family feels uniform.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Do not duplicate the per-conversation line shape. Either share
  the existing `renderHistorySearchPlain` helper across the
  language boundary by re-deriving the same line format from the
  typed conversations on the mobile side, or factor a small typed
  renderer that both surfaces can call — whichever produces fewer
  moving parts. No third format.

## Done When

- `clients/mobile/src/screens/HistoryScreen.tsx` renders the
  HistoryScreen, registered in the navigation map and reachable
  from the existing menu/tab structure alongside KnowledgeScreen,
  MemoryScreen, DigestScreen, and AttentionScreen.
- `DaemonContext` exposes `historyQuery`, `historyResult`,
  `historyLoading`, `historyError`, and `searchHistory(query)`,
  matching the knowledge/memory/digest/attention shape, with
  reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- The mobile `DaemonClient` adds a `searchHistory(query, limit)`
  call against the daemon HTTP route, returning the same
  discriminated `{ ok: true, conversations: ConversationRecord[] }
  | { ok: false, reason: "semantic_unavailable" }` envelope, with
  a typed mirror in `clients/mobile/src/types.ts`.
- `clients/mobile/src/__tests__/HistoryScreen.test.tsx` covers the
  populated-results state, the empty-results state, the empty-
  query usage hint, the semantic-unavailable branch, and the
  error state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds the
  same search-success / semantic-unavailable / unknown-reason /
  malformed-conversation / HTTP-error coverage already in place
  for `searchKnowledge` and `searchMemory`.
- The shared `renderHistorySearchPlain` line shape is preserved
  one-to-one on the mobile surface, verified by a rendered-output
  sample assertion in the screen test.
- The mobile test command and the history module's tests both
  pass cleanly; no other history-fan-out tests regress.

## Source / Intent

The just-completed macOS HistoryView task
(`task-add-macos-menu-bar-historyview-consuming-daemoncli`,
commit `af334e4d`) and its prerequisite daemon-client subtask
(`task-add-macos-daemonclientsearchhistory-with-discrimin`,
commit `aee663ff`) extended the history fan-out from
Telegram → CLI → daemon HTTP to the always-visible native operator
surface. The prior memory / knowledge / daily-digest / attention
seam fan-outs explicitly establish the cadence Telegram → CLI →
daemon HTTP → macOS → mobile; the mobile screen is the remaining
step. With this task done, the history surface reaches the same
multi-client parity the digest, attention, knowledge, and memory
seams already have, and an operator on a phone gains direct
access to project conversation search.

## Initiative

History seam fan-out — match the digest, attention, knowledge,
and memory seams' multi-surface client coverage so the on-demand
semantic conversation search the daemon already serves is
reachable from every operator surface, including the mobile
screen, without context-switching to another client.

## Acceptance Evidence

- Mobile test command output showing the new HistoryScreen
  reducer, navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile HistoryScreen showing
  the populated-results, empty-results, empty-query-hint, and
  semantic-unavailable states driven by the same daemon route.
- A short rendered-output sample (line shape) from the
  HistoryScreen next to the equivalent `kota history search` CLI
  output and the Telegram `/history` body proving line-shape
  parity.
