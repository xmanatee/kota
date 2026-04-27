---
id: task-add-macos-menu-bar-historyview-consuming-daemoncli
title: Add macOS menu-bar HistoryView consuming DaemonClient.searchHistory
status: ready
priority: p2
area: client
summary: Add HistoryView.swift under clients/macos/Sources/KotaMenuBar/, wire it into MenuBarView.swift as a collapsible section consistent with MemoryView/KnowledgeView/DigestView/AttentionView, extend AppState with the history search observables (current query, current result, in-flight, last error), and render the four operator-visible branches one-to-one with the daemon contract: id+updatedAt+messageCount+title lines (matching renderHistorySearchPlain), empty-result body, empty-query usage hint, and the semantic-unavailable explanation. Capture the four screenshots and update src/modules/history/AGENTS.md to name the macOS menu bar as a history-surface consumer.
created_at: 2026-04-27T04:13:00.951Z
updated_at: 2026-04-27T04:13:00.951Z
---

## Problem

The macOS menu bar already hosts `DigestView`, `AttentionView`,
`KnowledgeView`, and the just-landed `MemoryView` from the prior
operator-pull fan-outs, but it has no History surface. After the daemon
contract layer subtask
(`task-add-macos-daemonclientsearchhistory-with-discrimin`, commit
`aee663ff`) landed, the typed `DaemonClient.searchHistory(query:limit:)`
and the `HistorySearchResponse` mirror — alongside the
`renderHistorySearchPlain` Swift helper — exist with passing unit tests.
But operators supervising KOTA from the menu bar still have to context-
switch to a terminal, browser, or Telegram chat to query past
conversations. The daemon route ships, the CLI exposes it via `kota
history search`, and Telegram exposes it via the just-shipped `/history`
command (commit `8fe35c69`); the always-visible native operator surface
does not.

## Desired Outcome

The macOS menu bar gains a History surface — a `HistoryView` rendered
from `MenuBarView.swift` (collapsible section consistent with the
Memory, Knowledge, Digest, and Attention sections) — that lets the
operator type a query, calls `DaemonClient.searchHistory(query: query,
limit: 10)` (semantic search), decodes the typed response, and renders
the top conversations one line each: id, updatedAt (ISO-8601 16-char
slice with `T` replaced by space), messageCount (right-padded to width
4) + ` msgs`, and title (the same line shape `renderHistorySearchPlain`
and the CLI `kota history search` already emit). The semantic-
unavailable branch surfaces explicitly with a one-line explanation, not
a silent degrade. Empty / whitespace-only queries surface an inline
usage hint and skip the request. Empty result sets surface a fixed "No
matching conversations." body so the operator can distinguish "nothing
matched" from "command failed". The view uses the existing `DaemonClient`
/ `AppState` model that every other section uses; it does not introduce
a parallel data layer or duplicate the rendering logic that already
lives in the `history` module.

## Constraints

- This subtask depends on the daemon contract layer subtask
  (`task-add-macos-daemonclientsearchhistory-with-discrimin`) being
  done; it consumes that subtask's typed `searchHistory` method,
  `HistorySearchResponse` discriminated mirror, and
  `renderHistorySearchPlain` helper as-is. Do not redefine those types
  here.
- Add `HistoryView.swift` under
  `clients/macos/Sources/KotaMenuBar/` and wire it into
  `MenuBarView.swift` as a collapsible section consistent with
  `MemoryView`, `KnowledgeView`, `DigestView`, and `AttentionView`. Do
  not introduce a separate sheet or window for the search.
- Extend `AppState.swift` with the history search state (current query,
  current result, in-flight, last error) using the same observable
  pattern the memory/knowledge/digest/attention sections use. The view
  binds to `AppState`; it does not own its own data layer or call
  `URLSession` directly.
- Render each conversation using the `renderHistorySearchPlain` Swift
  helper shipped in the contract subtask (id padded to widest, min
  width 2; updatedAt sliced to 16 chars with `T` → space; messageCount
  right-padded to width 4 + ` msgs`; title). Do not re-implement any
  Markdown styling, do not strip fields, and do not invent a new line
  format that diverges from Telegram / CLI / web.
- Empty / whitespace-only query: do not call the route. Show a usage
  hint inline ("Type a query to search history."). Empty result set
  with a non-empty query: render the fixed "No matching conversations."
  body. Semantic-unavailable response (`HistorySearchResponse
  .semanticUnavailable`): render a one-line explanation that semantic
  history search requires an embedding-backed history provider; do not
  retry the request without semantic.
- The on-demand pull invariants stay intact: the macOS client must not
  emit a workflow event, must not advance any cadence file, and the
  rendered body must not flow into any agent prompt path. The macOS
  client never reads `.kota/` files directly except through the
  existing `daemon-control.json` discovery path
  (`clients/macos/AGENTS.md`), and that boundary is preserved.
- If the `DaemonClient` hits an HTTP error, the view shows the same
  offline/error state pattern other views use; it must not preserve a
  stale history result across an offline transition
  (`clients/macos/AGENTS.md`).
- The view never reads the file-backed conversation log directly. All
  data flows through the daemon HTTP route via the contract layer
  shipped in the prerequisite subtask.
- One mechanism. A single `HistoryView` consumed by
  `MenuBarView.swift`, not two duplicated render paths.

## Done When

- `HistoryView.swift` lives under
  `clients/macos/Sources/KotaMenuBar/` and is wired into
  `MenuBarView.swift` so operators can search past conversations
  without leaving the menu bar.
- `AppState.swift` exposes the history search state (current query,
  current result, in-flight, last error) with the same observable
  pattern other sections use; the view renders the rendered line
  shape, the empty-result body ("No matching conversations."), the
  empty-query usage hint ("Type a query to search history."), and the
  semantic-unavailable explanation.
- `swift build` and `swift test` are green for the macOS client.
- `src/modules/history/AGENTS.md` names the macOS menu bar as a
  consumer of the history surface (one-line update, not a duplicated
  catalog). `clients/macos/AGENTS.md` does not need to enumerate the
  new view — the generic "all state comes from the daemon API through
  the daemon client wrapper" guidance already covers it.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the just-shipped
macOS `DaemonClient.searchHistory` contract layer (commit `aee663ff`),
which mirrored the memory/knowledge cluster contract subtasks one-to-
one for the history surface. The next step in the cadence established
by the digest, knowledge, and memory fan-outs is the menu-bar view
that consumes the typed contract layer — directly mirroring
`task-add-macos-menu-bar-memoryview-consuming-daemonclie` (commit
`5b26947d`) and `task-add-macos-menu-bar-knowledgeview-consuming-daemonc`
(commit `5d66bffd`). Decomposing the contract from the view follows the
lesson encoded in the knowledge cluster
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp` timed out at ~17
minutes when the contract layer plus SwiftUI view plus AppState wiring
plus operator capture were bundled into one builder run): keep the view
subtask scoped to `HistoryView.swift` + `AppState.swift` observables +
`MenuBarView.swift` wiring + operator capture so a single builder run
can land it without re-debating the daemon shape.

## Initiative

Operator-pull parity for the history surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares one
search seam through `GET /api/history/search`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication. This task ships the macOS menu-bar view that consumes the
tested daemon contract layer.

## Acceptance Evidence

- Diff covering the new `HistoryView.swift`, the `AppState`
  observables, the wiring into `MenuBarView.swift`, and the one-line
  update to `src/modules/history/AGENTS.md`.
- Screenshots under `.kota/runs/<run-id>/` of the menu bar rendering:
  a successful search with conversations, the empty-result body, the
  empty-query usage hint, and the semantic-unavailable explanation.
  Pair the successful case alongside the corresponding `kota history
  search` text and Telegram `/history` reply for the same query and
  same project state to demonstrate body parity across surfaces.
- `swift build` and `swift test` output green for the macOS client,
  captured under `.kota/runs/<run-id>/`.
