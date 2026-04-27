---
id: task-add-macos-menu-bar-tasksearchview-consuming-daemon
title: Add macOS menu bar TaskSearchView consuming DaemonClient.searchTasks
status: done
priority: p2
area: client
summary: Add a TaskSearchView in the macOS menu bar (mirroring HistoryView, MemoryView, KnowledgeView) that calls DaemonClient.searchTasks for the repo-task-queue semantic-search seam, surfaces the discriminated populated/empty/empty-query/semantic-unavailable branches, and renders the same id/state/priority/title line shape renderRepoTaskSearchPlain emits, completing the macOS step in the tasks-semantic fan-out.
created_at: 2026-04-27T06:30:49.748Z
updated_at: 2026-04-27T06:49:05.526Z
---

## Problem

Once `DaemonClient.searchTasks` and the discriminated
`TasksSearchResponse` mirror land
(`task-add-macos-daemonclientsearchtasks-with-discriminat`), the
macOS menu-bar client has a typed daemon contract for the
`/tasks/search` route but no view that exposes it to the operator.
The existing `clients/macos/Sources/KotaMenuBar/` views — `DigestView`,
`AttentionView`, `KnowledgeView`, `MemoryView`, `HistoryView` — give
the operator on-demand semantic recall over digest, attention,
knowledge, memory, and conversation history; the repo task queue
remains the only major operator-relevant store with a typed daemon
contract on macOS but no view, forcing operators back to a terminal
(`kota task search`), Telegram, or another client.

## Desired Outcome

`clients/macos/Sources/KotaMenuBar/TaskSearchView.swift` exists,
mirrors `HistoryView` shape one-to-one, and is mounted in the
existing menu-bar navigation alongside the five existing semantic
views. The view exposes a search input, a "Search" affordance, and
a result list. It calls `DaemonClient.searchTasks(query:limit:states:)`
with a sensible default (`limit: 10`, `states: nil`) and renders the
result through the Swift `renderRepoTaskSearchPlain` mirror landed
by the predecessor task.

The four operator-visible branches surface one-to-one with the
daemon contract:

- Per-task ranked rendered lines for non-empty results
  (id, state, priority, title — same shape as
  `renderRepoTaskSearchPlain`).
- A fixed empty-result body ("No matching tasks.") so the operator
  can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request, matching the `KnowledgeView` / `MemoryView` /
  `HistoryView` precedent.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

## Constraints

- Build on the existing `AppState` and view composition
  (`clients/macos/Sources/KotaMenuBar/AppState.swift`,
  `MenuBarView.swift`); do not add a parallel state container or
  navigation surface just for tasks search.
- Reuse the typed `DaemonClient.searchTasks` and the Swift
  `renderRepoTaskSearchPlain` mirror landed by the predecessor task.
  Do not call the route directly, do not re-derive a parallel render
  helper, do not add a third tasks-search response type on the macOS
  side.
- Match `KnowledgeView` / `MemoryView` / `HistoryView` interaction
  discipline: explicit loading / error / empty / quiet states, no
  eager fetch when the daemon is offline, the same submit-on-Enter
  + button affordance shape.
- Surface the discriminated semantic-unavailable branch as a
  dedicated message in the view; do not collapse it into the
  empty-results branch.
- Add coverage for the view in
  `clients/macos/Tests/KotaMenuBarTests/` mirroring the existing
  `HistoryViewTests` (or equivalent) shape — populated, empty,
  empty-query, semantic-unavailable, error.

## Done When

- `clients/macos/Sources/KotaMenuBar/TaskSearchView.swift` renders
  the view, registered in the menu-bar navigation alongside
  `DigestView`, `AttentionView`, `KnowledgeView`, `MemoryView`,
  `HistoryView`.
- `AppState` exposes the tasks-search query / result / loading /
  error state in the same shape as the predecessor history search
  state, with reducer or state-test coverage.
- The view test cases cover the populated, empty, empty-query,
  semantic-unavailable, and error states.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation passes.

## Source / Intent

This task is the macOS view step in the repo-task-queue semantic
search fan-out opened by `fa0ee92e` and continued by
`task-add-macos-daemonclientsearchtasks-with-discriminat`. The
cadence Telegram → CLI → daemon → macOS DaemonClient → macOS view
→ mobile screen the prior memory / knowledge / history seam fan-outs
established places this task immediately after the macOS DaemonClient
contract task lands, mirroring the
`task-add-macos-menu-bar-historyview-consuming-daemoncli` template
one-to-one for the repo-task-queue surface.

## Initiative

Operator-pull parity for the repo-task-queue surface. This task
lands the macOS view step so an operator on macOS can search the
repo task queue without context-switching to a terminal, Telegram,
or another client.

## Acceptance Evidence

- Diff covering the new `TaskSearchView.swift`, the AppState
  additions, the navigation registration, and the new view tests.
- `swift test` output showing the new TaskSearchView tests passing
  alongside the existing macOS test suite, captured under
  `.kota/runs/<run-id>/`.
- A screenshot of the macOS menu-bar `TaskSearchView` showing the
  populated-results state next to the equivalent `kota task search`
  CLI output and the Telegram `/tasks` body proving line-shape
  parity.
