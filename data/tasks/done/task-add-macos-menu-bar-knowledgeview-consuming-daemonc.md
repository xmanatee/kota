---
id: task-add-macos-menu-bar-knowledgeview-consuming-daemonc
title: Add macOS menu-bar KnowledgeView consuming DaemonClient.searchKnowledge
status: done
priority: p2
area: client
summary: Add KnowledgeView.swift under clients/macos/Sources/KotaMenuBar/, wire it into MenuBarView.swift as a collapsible section consistent with DigestView and AttentionView, extend AppState with the search state observables (current query, current result, in-flight, last error) using the same pattern other sections use, and render the four operator-visible branches one-to-one with the daemon contract: per-entry id+type+status+title lines (matching renderKnowledgeSearchPlain), empty-result body, empty-query usage hint, and the semantic-unavailable explanation. Capture the four screenshots and update src/modules/knowledge/AGENTS.md to name the macOS menu bar as a knowledge-surface consumer (one-line update).
created_at: 2026-04-26T12:54:12.303Z
updated_at: 2026-04-26T23:57:32.119Z
---

## Problem

The macOS menu bar already hosts the `DigestView` and `AttentionView` from
the prior daily-supervision fan-outs, but it has no Knowledge surface.
After the daemon contract layer subtask
(`task-add-macos-daemonclientsearchknowledge-with-discrim`) lands, the
typed `DaemonClient.searchKnowledge(query:limit:)` and the
`KnowledgeSearchResponse` mirror exist with passing unit tests — but
operators supervising KOTA from the menu bar still have to context-
switch to a terminal, browser, or Telegram chat to query the project
knowledge store. The daemon route ships and Telegram exposes it; the
always-visible native operator surface does not.

## Desired Outcome

The macOS menu bar gains a Knowledge surface — a `KnowledgeView` rendered
from `MenuBarView.swift` (collapsible section consistent with the Digest
and Attention sections) — that lets the operator type a query, calls
`DaemonClient.searchKnowledge(query: query, limit: 10)` (semantic
search), decodes the typed response, and renders the top entries one
line each: id, type, status, and title (the same line shape
`renderKnowledgeSearchPlain` and the CLI `buildKnowledgeSearchLines`
already emit). The semantic-unavailable branch surfaces explicitly with
a one-line explanation, not a silent degrade. Empty / whitespace-only
queries surface an inline usage hint and skip the request. Empty result
sets surface a fixed "No matching knowledge entries." body so the
operator can distinguish "nothing matched" from "command failed". The
view uses the existing `DaemonClient` / `AppState` model that every
other section uses; it does not introduce a parallel data layer or
duplicate the rendering logic that already lives in the `knowledge`
module.

## Constraints

- This subtask depends on the daemon contract layer subtask
  (`task-add-macos-daemonclientsearchknowledge-with-discrim`) being
  done first; it consumes that subtask's typed `searchKnowledge` method
  and `KnowledgeSearchResponse` mirror as-is. Do not redefine those
  types here.
- Add `KnowledgeView.swift` under
  `clients/macos/Sources/KotaMenuBar/` and wire it into
  `MenuBarView.swift` as a collapsible section consistent with
  `DigestView` and `AttentionView`. Do not introduce a separate sheet
  or window for the search.
- Extend `AppState.swift` with the search state (current query, current
  result, in-flight, last error) using the same observable pattern the
  digest/attention sections use. The view binds to `AppState`; it does
  not own its own data layer or call `URLSession` directly.
- Render each entry using the same line shape the shared knowledge
  render helper emits — id, type, status, title. Do not re-implement
  Markdown styling, do not strip fields, and do not invent a new line
  format that diverges from Telegram / CLI / web.
- Empty / whitespace-only query: do not call the route. Show a usage
  hint inline ("Type a query to search knowledge."). Empty result set
  with a non-empty query: render the fixed "No matching knowledge
  entries." body. `ok: false`: render a one-line explanation that
  semantic search requires an embedding-backed knowledge provider; do
  not retry the request without semantic.
- The on-demand pull invariants stay intact: the macOS client must not
  emit a workflow event, must not advance any cadence file, and the
  rendered body must not flow into any agent prompt path. The macOS
  client never reads `.kota/` files directly except through the
  existing `daemon-control.json` discovery path
  (`clients/macos/AGENTS.md`), and that boundary is preserved.
- If the `DaemonClient` hits an HTTP error, the view shows the same
  offline/error state pattern other views use; it must not preserve a
  stale knowledge result across an offline transition
  (`clients/macos/AGENTS.md`).
- The view never reads the file-backed `KnowledgeStore` directly. All
  data flows through the daemon HTTP route via the contract layer
  shipped in the prerequisite subtask.
- One mechanism. A single `KnowledgeView` consumed by
  `MenuBarView.swift`, not two duplicated render paths.

## Done When

- `KnowledgeView.swift` lives under
  `clients/macos/Sources/KotaMenuBar/` and is wired into
  `MenuBarView.swift` so operators can search the knowledge store
  without leaving the menu bar.
- `AppState.swift` exposes the search state (current query, current
  result, in-flight, last error) with the same observable pattern other
  sections use; the view renders the rendered line shape, the empty-
  result body ("No matching knowledge entries."), the empty-query usage
  hint ("Type a query to search knowledge."), and the semantic-
  unavailable explanation.
- `swift build` and `swift test` are green for the macOS client.
- `src/modules/knowledge/AGENTS.md` names the macOS menu bar as a
  consumer of the knowledge surface (one-line update, not a duplicated
  catalog). `clients/macos/AGENTS.md` does not need to enumerate the
  new view — the generic "all state comes from the daemon API through
  the daemon client wrapper" guidance already covers it.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

Decomposed from
`task-add-macos-menu-bar-knowledgeview-consuming-apiknow`, which timed
out under one builder run while still in the contract-design phase
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp`, ~17 minutes,
streamed-API idle timeout). The original task bundles the daemon
contract layer with the SwiftUI view layer, AppState observables,
MenuBarView integration, four-branch operator screenshots, and a docs
update. Splitting the contract layer off into
`task-add-macos-daemonclientsearchknowledge-with-discrim` lets this
subtask focus on UI behavior, AppState wiring, and operator capture
without re-debating the daemon shape. The original empty-`ready/`
queue (counts.ready=0) followed the Telegram `/knowledge` command
landing (commits `f2d1a248` and `53883ef2`) and was specifically
seeded to extend the knowledge surface fan-out from Telegram to the
always-visible macOS operator surface — preserving that intent.

## Initiative

Operator-pull parity for the knowledge surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares one
search seam through `GET /api/knowledge/search`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication. This task ships the macOS menu-bar view that consumes the
tested daemon contract layer.

## Acceptance Evidence

- Diff covering the new `KnowledgeView.swift`, the `AppState`
  observables, the wiring into `MenuBarView.swift`, and the one-line
  update to `src/modules/knowledge/AGENTS.md`.
- Screenshots under `.kota/runs/<run-id>/` of the menu bar rendering:
  a successful search with entries, the empty-result body, the
  empty-query usage hint, and the semantic-unavailable explanation.
  Pair the successful case alongside the corresponding `kota
  knowledge search` text and Telegram `/knowledge` reply for the
  same query and same project state to demonstrate body parity
  across surfaces.
- `swift build` and `swift test` output green for the macOS client,
  captured under `.kota/runs/<run-id>/`.
