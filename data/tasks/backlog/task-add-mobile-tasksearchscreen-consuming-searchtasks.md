---
id: task-add-mobile-tasksearchscreen-consuming-searchtasks
title: Add mobile TaskSearchScreen consuming searchTasks
status: backlog
priority: p2
area: client
summary: Add a TaskSearchScreen in the mobile client (mirroring HistoryScreen, MemoryScreen, KnowledgeScreen) that calls GET /tasks/search through the mobile daemon HTTP client, exposes search state on DaemonContext, and renders the same per-task id/state/priority/title line shape the four other repo-task-search surfaces emit, closing the operator-pull parity loop for the tasks-semantic fan-out across Telegram, daemon, CLI, macOS DaemonClient, macOS TaskSearchView, and mobile.
created_at: 2026-04-27T06:30:52.806Z
updated_at: 2026-04-27T06:30:52.806Z
---

## Problem

The repo-task-queue semantic-search seam will already be reachable
through five surfaces once the macOS DaemonClient + view tasks land
(`task-add-macos-daemonclientsearchtasks-with-discriminat`,
`task-add-macos-menu-bar-tasksearchview-consuming-daemon`):

- `kota task search` CLI (`src/modules/repo-tasks/cli.ts:277`).
- Daemon control route `GET /tasks/search`
  (`src/modules/repo-tasks/routes.ts:531-592`); the route returns
  `{ ok: true, tasks: RepoTaskSearchHit[] } | { ok: false, reason: "semantic_unavailable" }`.
- Telegram `/tasks <query>` command, rendered via the shared
  `renderRepoTaskSearchPlain` helper.
- macOS `DaemonClient.searchTasks(query:limit:states:)` with a typed
  `TasksSearchResponse` mirror.
- macOS menu bar `TaskSearchView`.

The mobile client is the last surface in the established cadence
(Telegram → CLI → daemon → macOS → mobile). It already exposes the
digest, attention, knowledge, memory, and history bodies through
`clients/mobile/src/screens/DigestScreen.tsx`,
`AttentionScreen.tsx`, `KnowledgeScreen.tsx`, `MemoryScreen.tsx`,
`HistoryScreen.tsx`; the navigation map
(`clients/mobile/src/navigation/index.tsx`) registers each of those
screens; and `clients/mobile/src/context/DaemonContext.tsx` already
exposes `searchKnowledge`, `searchMemory`, and `searchHistory` plus
the matching reducer state. There is no equivalent
`TaskSearchScreen`, no `searchTasks*` state on `DaemonContext`, and
no `searchTasks()` call against the daemon route the other five
surfaces consume — so an operator on a phone has no way to search
the repo task queue without context-switching to a terminal,
browser, Telegram chat, macOS menu bar, or another client.

## Desired Outcome

The mobile client gains a TaskSearchScreen — a navigation-mounted
screen mirroring `HistoryScreen` / `MemoryScreen` / `KnowledgeScreen`
shape — with a search input, a "Search" affordance, and a result
list. It calls `GET /tasks/search?q=&semantic=true&limit=10`
through the mobile daemon HTTP client, exposes the query, last
result, in-flight, and last-error state on `DaemonContext` under
`tasksQuery` / `tasksResult` / `tasksLoading` / `tasksError` with a
`searchTasks(query)` method, and renders the same per-task id /
state / priority / title line shape the shared
`renderRepoTaskSearchPlain` helper and the macOS `TaskSearchView`
already emit.

The four operator-visible branches surface one-to-one with the
daemon contract:

- Per-task ranked rendered lines for non-empty results.
- A fixed empty-result body ("No matching tasks.") so the operator
  can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

## Constraints

- Build on the existing `DaemonContext`, navigation map, and screen
  composition; do not add a parallel state container, navigation
  stack, or HTTP client just for tasks search. The new screen should
  not collide with the existing `TaskQueueScreen`, which surfaces
  state-grouped queue counts from `/tasks` — the new screen targets
  the semantic-search seam at `/tasks/search`.
- Reuse the same daemon HTTP route (`GET /tasks/search`) the CLI /
  Telegram / macOS surfaces consume. Do not introduce a second
  tasks-search seam, response model, or rendering helper on the
  mobile side.
- Mirror the macOS `DaemonClient.searchTasks` contract: the mobile
  `searchTasks` method must return the same discriminated
  `{ ok: true, tasks: RepoTaskSearchHit[] } | { ok: false, reason:
  "semantic_unavailable" }` shape and reject other shapes loudly,
  identical in structure to the existing mobile `searchKnowledge`,
  `searchMemory`, and `searchHistory`.
- Match HistoryScreen / KnowledgeScreen / MemoryScreen interaction
  discipline: pull-to-refresh on the result list (re-runs the last
  query), explicit loading / error / empty / quiet states, no eager
  fetch when the daemon is offline.
- Keep TaskSearchScreen visually consistent with the five sibling
  pull-surfaces so the family feels uniform.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Do not duplicate the per-task line shape. Either share the
  existing `renderRepoTaskSearchPlain` helper across the language
  boundary by re-deriving the same line format from the typed tasks
  on the mobile side, or factor a small typed renderer that both
  surfaces can call — whichever produces fewer moving parts. No
  third format.

## Done When

- `clients/mobile/src/screens/TaskSearchScreen.tsx` renders the
  TaskSearchScreen, registered in the navigation map and reachable
  from the existing menu/tab structure alongside HistoryScreen,
  MemoryScreen, KnowledgeScreen, DigestScreen, AttentionScreen.
- `DaemonContext` exposes `tasksQuery`, `tasksResult`,
  `tasksLoading`, `tasksError`, and `searchTasks(query)`, matching
  the knowledge/memory/history shape, with reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- The mobile `DaemonClient` adds a `searchTasks(query, limit)` call
  against the daemon HTTP route, returning the same discriminated
  envelope, with a typed mirror in `clients/mobile/src/types.ts`.
- `clients/mobile/src/__tests__/TaskSearchScreen.test.tsx` covers the
  populated-results state, the empty-results state, the empty-query
  usage hint, the semantic-unavailable branch, and the error state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds the same
  search-success / semantic-unavailable / unknown-reason /
  malformed-task / HTTP-error coverage already in place for
  `searchKnowledge`, `searchMemory`, and `searchHistory`.
- The shared `renderRepoTaskSearchPlain` line shape is preserved
  one-to-one on the mobile surface, verified by a rendered-output
  sample assertion in the screen test.
- The mobile test command and the repo-tasks module's tests both
  pass cleanly; no other tasks-fan-out tests regress.

## Source / Intent

The just-shipped Telegram `/tasks` command (commit `fc471f0b`) and
the planned macOS DaemonClient + macOS TaskSearchView subtasks
extend the tasks-semantic fan-out from Telegram + CLI + daemon to
the always-visible native operator surface. The prior memory /
knowledge / daily-digest / attention / history seam fan-outs
explicitly establish the cadence Telegram → CLI → daemon → macOS →
mobile; the mobile screen is the remaining step. With this task
done, the repo-task-queue surface reaches the same multi-client
parity the digest, attention, knowledge, memory, and history seams
already have, and an operator on a phone gains direct access to
project task search.

## Initiative

Operator-pull parity for the repo-task-queue surface — match the
digest, attention, knowledge, memory, and history seams' multi-
surface client coverage so the on-demand semantic task-queue search
the daemon already serves is reachable from every operator surface,
including the mobile screen, without context-switching to another
client. This closes the "semantic recall reachable from any operator
surface" loop for the last major repo store.

## Acceptance Evidence

- Mobile test command output showing the new TaskSearchScreen
  reducer, navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile TaskSearchScreen showing
  the populated-results, empty-results, empty-query-hint, and
  semantic-unavailable states driven by the same daemon route.
- A short rendered-output sample (line shape) from the
  TaskSearchScreen next to the equivalent `kota task search` CLI
  output and the Telegram `/tasks` body proving line-shape parity.
