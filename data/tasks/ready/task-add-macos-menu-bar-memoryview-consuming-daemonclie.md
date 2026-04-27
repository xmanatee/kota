---
id: task-add-macos-menu-bar-memoryview-consuming-daemonclie
title: Add macOS menu-bar MemoryView consuming DaemonClient.searchMemory
status: ready
priority: p2
area: client
summary: Add MemoryView.swift under clients/macos/Sources/KotaMenuBar/, wire it into MenuBarView.swift as a collapsible section consistent with KnowledgeView/DigestView/AttentionView, extend AppState with the memory search observables (current query, current result, in-flight, last error) using the same pattern other sections use, and render the four operator-visible branches one-to-one with the daemon contract: id+date+content snippet lines (matching renderMemorySearchPlain), empty-result body, empty-query usage hint, and the semantic-unavailable explanation. Capture the four screenshots and update src/modules/memory/AGENTS.md to name the macOS menu bar as a memory-surface consumer (one-line update).
created_at: 2026-04-27T01:51:57.233Z
updated_at: 2026-04-27T01:51:57.233Z
---

## Problem

The macOS menu bar already hosts `DigestView`, `AttentionView`, and the
just-landed `KnowledgeView` from the prior daily-supervision and
knowledge-search fan-outs, but it has no Memory surface. After the
daemon contract layer subtask
(`task-add-macos-daemonclientsearchmemory-with-discrimina`, commit
`f915cbd7`) landed, the typed `DaemonClient.searchMemory(query:limit:)`
and the `MemorySearchResponse` mirror exist with passing unit tests —
but operators supervising KOTA from the menu bar still have to context-
switch to a terminal, browser, or Telegram chat to query the project
memory store. The daemon route ships and Telegram exposes it via the
just-shipped `/memory` command (commit `190770b3`); the always-visible
native operator surface does not.

## Desired Outcome

The macOS menu bar gains a Memory surface — a `MemoryView` rendered
from `MenuBarView.swift` (collapsible section consistent with the
Knowledge, Digest, and Attention sections) — that lets the operator
type a query, calls `DaemonClient.searchMemory(query: query, limit:
10)` (semantic search), decodes the typed response, and renders the
top entries one line each: id, date (ISO-8601 `YYYY-MM-DD HH:MM`
slice), and content snippet (the same line shape
`renderMemorySearchPlain` and the CLI `kota memory search` already
emit). The semantic-unavailable branch surfaces explicitly with a
one-line explanation, not a silent degrade. Empty / whitespace-only
queries surface an inline usage hint and skip the request. Empty
result sets surface a fixed "No matching memory entries." body so the
operator can distinguish "nothing matched" from "command failed". The
view uses the existing `DaemonClient` / `AppState` model that every
other section uses; it does not introduce a parallel data layer or
duplicate the rendering logic that already lives in the `memory`
module.

## Constraints

- This subtask depends on the daemon contract layer subtask
  (`task-add-macos-daemonclientsearchmemory-with-discrimina`) being
  done; it consumes that subtask's typed `searchMemory` method and
  `MemorySearchResponse` mirror as-is. Do not redefine those types
  here.
- Add `MemoryView.swift` under
  `clients/macos/Sources/KotaMenuBar/` and wire it into
  `MenuBarView.swift` as a collapsible section consistent with
  `KnowledgeView`, `DigestView`, and `AttentionView`. Do not introduce
  a separate sheet or window for the search.
- Extend `AppState.swift` with the memory search state (current query,
  current result, in-flight, last error) using the same observable
  pattern the knowledge/digest/attention sections use. The view binds
  to `AppState`; it does not own its own data layer or call
  `URLSession` directly.
- Render each entry using the `renderMemorySearchPlain` Swift helper
  shipped in the contract subtask — id, date (16-char ISO-8601 slice),
  content snippet (60-char width with newlines collapsed). Do not
  re-implement Markdown styling, do not strip fields, and do not
  invent a new line format that diverges from Telegram / CLI / web.
- Empty / whitespace-only query: do not call the route. Show a usage
  hint inline ("Type a query to search memory."). Empty result set
  with a non-empty query: render the fixed "No matching memory
  entries." body. `ok: false`: render a one-line explanation that
  semantic memory search requires an embedding-backed memory provider;
  do not retry the request without semantic.
- The on-demand pull invariants stay intact: the macOS client must not
  emit a workflow event, must not advance any cadence file, and the
  rendered body must not flow into any agent prompt path. The macOS
  client never reads `.kota/` files directly except through the
  existing `daemon-control.json` discovery path
  (`clients/macos/AGENTS.md`), and that boundary is preserved.
- If the `DaemonClient` hits an HTTP error, the view shows the same
  offline/error state pattern other views use; it must not preserve a
  stale memory result across an offline transition
  (`clients/macos/AGENTS.md`).
- The view never reads the file-backed `MemoryStore` directly. All
  data flows through the daemon HTTP route via the contract layer
  shipped in the prerequisite subtask.
- One mechanism. A single `MemoryView` consumed by
  `MenuBarView.swift`, not two duplicated render paths.

## Done When

- `MemoryView.swift` lives under
  `clients/macos/Sources/KotaMenuBar/` and is wired into
  `MenuBarView.swift` so operators can search the memory store
  without leaving the menu bar.
- `AppState.swift` exposes the memory search state (current query,
  current result, in-flight, last error) with the same observable
  pattern other sections use; the view renders the rendered line
  shape, the empty-result body ("No matching memory entries."), the
  empty-query usage hint ("Type a query to search memory."), and the
  semantic-unavailable explanation.
- `swift build` and `swift test` are green for the macOS client.
- `src/modules/memory/AGENTS.md` names the macOS menu bar as a
  consumer of the memory surface (one-line update, not a duplicated
  catalog). `clients/macos/AGENTS.md` does not need to enumerate the
  new view — the generic "all state comes from the daemon API
  through the daemon client wrapper" guidance already covers it.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the just-shipped
macOS `DaemonClient.searchMemory` contract layer (commit `f915cbd7`),
which mirrored the knowledge cluster's contract subtask
(`task-add-macos-daemonclientsearchknowledge-with-discrim`, commit
`b363a54a`) one-to-one for the memory surface. The next step in the
cadence established by both the digest and knowledge fan-outs is the
menu-bar view that consumes the typed contract layer — directly
mirroring `task-add-macos-menu-bar-knowledgeview-consuming-daemonc`
(commit `5d66bffd`). Decomposing the contract from the view follows
the lesson encoded in the knowledge cluster
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp` timed out at
~17 minutes when the contract layer plus SwiftUI view plus AppState
wiring plus operator capture were bundled into one builder run): keep
the view subtask scoped to `MemoryView.swift` + `AppState.swift`
observables + `MenuBarView.swift` wiring + operator capture so a
single builder run can land it without re-debating the daemon shape.

## Initiative

Operator-pull parity for the memory surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares
one search seam through `GET /api/memory/search`, with surface-
specific delivery wired through standard module patterns rather than
per-surface duplication. This task ships the macOS menu-bar view
that consumes the tested daemon contract layer.

## Acceptance Evidence

- Diff covering the new `MemoryView.swift`, the `AppState`
  observables, the wiring into `MenuBarView.swift`, and the one-line
  update to `src/modules/memory/AGENTS.md`.
- Screenshots under `.kota/runs/<run-id>/` of the menu bar rendering:
  a successful search with entries, the empty-result body, the
  empty-query usage hint, and the semantic-unavailable explanation.
  Pair the successful case alongside the corresponding `kota memory
  search` text and Telegram `/memory` reply for the same query and
  same project state to demonstrate body parity across surfaces.
- `swift build` and `swift test` output green for the macOS client,
  captured under `.kota/runs/<run-id>/`.
