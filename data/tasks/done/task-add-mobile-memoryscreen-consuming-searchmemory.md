---
id: task-add-mobile-memoryscreen-consuming-searchmemory
title: Add mobile MemoryScreen consuming searchMemory
status: done
priority: p2
area: client
summary: Add a MemoryScreen in the mobile client (mirroring KnowledgeScreen, DigestScreen, and AttentionScreen) that calls GET /api/memory/search through the mobile daemon HTTP client, exposes search query state on DaemonContext, and renders the same per-entry line shape plus the semantic-unavailable branch the four other memory surfaces emit — completing the memory fan-out across Telegram, daemon HTTP, macOS DaemonClient, macOS MemoryView, and mobile.
created_at: 2026-04-27T02:25:52.502Z
updated_at: 2026-04-27T02:33:01.403Z
---

## Problem

The `memory` module's operator-pull surface is now exposed on four
clients:

- `kota memory {list, search, show, ...}` CLI
  (`src/modules/memory/cli.ts`).
- Daemon HTTP `GET /api/memory` and `GET /api/memory/search`
  (`src/modules/memory/routes.ts`); the search route returns
  `{ ok: true, entries } | { ok: false, reason: "semantic_unavailable" }`
  so callers do not silently degrade to keyword search behind the
  operator's back.
- Telegram `/memory <query>` command
  (`src/modules/telegram/status-poll.ts`,
  `src/modules/telegram/AGENTS.md`), rendered via the shared
  `renderMemorySearchPlain` helper in `src/modules/memory/render.ts`.
- macOS menu bar `MemoryView`
  (`clients/macos/Sources/KotaMenuBar/MemoryView.swift`) consuming
  `DaemonClient.searchMemory(query:limit:)` with a typed
  `MemorySearchResponse` mirror.

The mobile client is the last surface in the established cadence
(Telegram → CLI → daemon HTTP → web → macOS → mobile). It already
exposes the digest, attention, and knowledge bodies through
`clients/mobile/src/screens/DigestScreen.tsx`,
`clients/mobile/src/screens/AttentionScreen.tsx`, and
`clients/mobile/src/screens/KnowledgeScreen.tsx`; the navigation map
(`clients/mobile/src/navigation/index.tsx`) registers the corresponding
screens, and `clients/mobile/src/context/DaemonContext.tsx` exposes
`refreshDigest`, `refreshAttention`, `searchKnowledge`, and the
matching reducer state. There is no equivalent `MemoryScreen`, no
`searchMemory*` state on `DaemonContext`, and no `searchMemory()` call
against the daemon route the other surfaces consume — so an operator
on a phone has no way to query the project memory store without
context-switching to a terminal, browser, Telegram chat, or the macOS
menu bar.

## Desired Outcome

The mobile client gains a MemoryScreen — a navigation-mounted screen
mirroring `KnowledgeScreen`, `DigestScreen`, and `AttentionScreen`
shape — with a search input, a "Search" affordance, and a result
list. It calls `GET /api/memory/search?q=&semantic=true&limit=10`
through the mobile daemon HTTP client, exposes the query, last
result, in-flight, and last-error state on `DaemonContext` under
`memoryQuery`/`memoryResult`/`memoryLoading`/`memoryError` with a
`searchMemory(query)` method, and renders the same per-entry line
shape the shared `renderMemorySearchPlain` helper and the macOS
`MemoryView` already emit.

The four operator-visible branches surface one-to-one with the daemon
contract:

- Per-entry rendered lines for non-empty results.
- A fixed empty-result body ("No matching memory entries.") so the
  operator can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

## Constraints

- Build on the existing `DaemonContext`, navigation map, and screen
  composition; do not add a parallel state container, navigation
  stack, or HTTP client just for memory.
- Reuse the same daemon HTTP route (`GET /api/memory/search`) the
  CLI / Telegram / macOS surfaces already consume. Do not introduce a
  second memory seam, response model, or rendering helper on the
  mobile side.
- Mirror `DaemonClient.searchMemory` from the macOS client: the
  mobile `searchMemory` method must return the same discriminated
  `{ ok: true, entries } | { ok: false, reason: "semantic_unavailable" }`
  shape and reject other shapes loudly, identical in structure to the
  existing mobile `searchKnowledge`.
- Match KnowledgeScreen / DigestScreen / AttentionScreen interaction
  discipline: pull-to-refresh on the result list (re-runs the last
  query), explicit loading / error / empty / quiet states, no eager
  fetch when the daemon is offline.
- Keep MemoryScreen visually consistent with the three sibling
  pull-surfaces so the four feel like one family.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Do not duplicate the per-entry line shape. Either share the
  existing `renderMemorySearchPlain` helper across the language
  boundary by re-deriving the same line format from the typed entries
  on the mobile side, or factor a small typed renderer that both
  surfaces can call — whichever produces fewer moving parts. No
  third format.

## Done When

- `clients/mobile/src/screens/MemoryScreen.tsx` renders the
  MemoryScreen, registered in the navigation map and reachable from
  the existing menu/tab structure alongside KnowledgeScreen,
  DigestScreen, and AttentionScreen.
- `DaemonContext` exposes `memoryQuery`, `memoryResult`,
  `memoryLoading`, `memoryError`, and `searchMemory(query)`, matching
  the knowledge/digest/attention shape, with reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- The mobile `DaemonClient` adds a `searchMemory(query, limit)` call
  against the daemon HTTP route, returning the same discriminated
  `{ ok: true, entries: MemoryEntry[] } | { ok: false, reason:
  "semantic_unavailable" }` envelope, with a typed mirror in
  `clients/mobile/src/types.ts`.
- `clients/mobile/src/__tests__/MemoryScreen.test.tsx` covers the
  populated-results state, the empty-results state, the empty-query
  usage hint, the semantic-unavailable branch, and the error state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds the same
  search-success / semantic-unavailable / unknown-reason / malformed-
  entry / HTTP-error coverage already in place for `searchKnowledge`.
- The shared `renderMemorySearchPlain` line shape is preserved one-
  to-one on the mobile surface, verified by a rendered-output sample
  assertion in the screen test.
- The mobile test command and the memory module's tests both pass
  cleanly; no other memory-fan-out tests regress.

## Source / Intent

The just-completed macOS MemoryView task
(`task-add-macos-menu-bar-memoryview-consuming-daemonclie`,
commit `5b26947d`) and its prerequisite daemon-client subtask
(`task-add-macos-daemonclientsearchmemory-with-discrimina`,
commit `f915cbd7`) extended the memory fan-out from Telegram → CLI →
daemon HTTP to the always-visible native operator surface. The macOS
task description and the prior knowledge / daily-digest / attention
seam fan-outs explicitly establish the cadence Telegram → CLI →
daemon HTTP → web → macOS → mobile; the mobile screen is the
remaining step. With this task done, the memory surface reaches the
same multi-client parity the digest, attention, and knowledge seams
already have, and an operator on a phone gains direct access to the
project memory store.

## Initiative

Memory seam fan-out — match the digest, attention, and knowledge
seams' multi-surface client coverage so the on-demand semantic search
the daemon already serves is reachable from every operator surface,
including the mobile screen, without context-switching to another
client.

## Acceptance Evidence

- Mobile test command output showing the new MemoryScreen reducer,
  navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile MemoryScreen showing the
  populated-results, empty-results, empty-query-hint, and
  semantic-unavailable states driven by the same daemon route.
- A short rendered-output sample (line shape) from the MemoryScreen
  next to the equivalent `kota memory search` CLI output and the
  Telegram `/memory` body proving line-shape parity.
