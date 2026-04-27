---
id: task-add-macos-menu-bar-recallview-consuming-daemonclie
title: Add macOS menu-bar RecallView consuming DaemonClient.recall
status: done
priority: p2
area: modules
summary: Add a SwiftUI menu-bar RecallView in clients/macos/Sources/KotaMenuBar/ that consumes the just-landed DaemonClient.recall and renders the four discriminated RecallHit arms, closing macOS parity in the recall fan-out.
created_at: 2026-04-27T09:25:53.222Z
updated_at: 2026-04-27T09:32:22.259Z
---

## Problem

The cross-store recall seam is now reachable from the CLI (`kota recall`),
the daemon (`POST /recall`), Telegram (`/recall`), and the web client
(`RecallPanel`). The macOS menu-bar app got the contract layer in
commit `559d9eed` (DaemonClient.recall + discriminated `RecallHit` enum +
`RecallSearchResponse` + `renderRecallHitsPlain` + four `DaemonClientTests`
cases), but the menu bar still has no SwiftUI view that lets the operator
actually issue a recall query and see ranked, source-tagged hits across
every registered store. As a result, the macOS surface still forces the
operator into per-store views (`KnowledgeView`, `MemoryView`,
`HistoryView`, `TaskSearchView`) for what should be one unified search,
the same gap the recall seam was built to close on every other surface.

## Desired Outcome

Add a `RecallView` SwiftUI view at
`clients/macos/Sources/KotaMenuBar/RecallView.swift`, modeled after the
existing single-tab views (`TaskSearchView`, `HistoryView`, etc.):

- Free-text query input plus a submit affordance, with debounced
  re-issue on submit (no auto-search-on-keystroke beyond what those
  peer views already do).
- Calls `DaemonClient.shared.recall(query:topK:minScore:sources:)` and
  renders the result.
- Renders all four `RecallHit` arms (`knowledge`, `memory`, `history`,
  `task`) with a clear source badge per row and the normalized
  `[0, 1]` score, preserving the existing `RECALL_SOURCE_ORDER`
  tie-breaker.
- Surfaces the `ok: false, reason: "semantic_unavailable"` arm as a
  user-facing notice (no thrown error), matching how `RecallPanel`
  and the Telegram `/recall` reply degrade.
- Wired into `MenuBarView` in the same place as the other per-store
  views, so the operator can select "Recall" alongside Knowledge /
  Memory / History / Tasks.

## Constraints

- Single new view file plus a `MenuBarView` integration edit; do not
  refactor the existing per-store views in this task.
- Reuse `renderRecallHitsPlain` from the existing macOS module rather
  than re-implementing the rendering logic in SwiftUI; the SwiftUI
  layer should focus on layout, score badges, and source badges.
- Do not introduce a new request shape or HTTP route — `DaemonClient.recall`
  already targets `POST /recall`, and the response contract already lives
  in `Models.swift`.
- Keep the file under the macOS-side size norm of the peer views
  (`TaskSearchView.swift` is 191 lines).
- No web/Telegram/CLI/mobile changes in this task — mobile `RecallScreen`
  is a separate follow-up.

## Done When

- `clients/macos/Sources/KotaMenuBar/RecallView.swift` exists, renders
  the four `RecallHit` arms with source + score badges, and handles the
  `ok: false, reason: "semantic_unavailable"` arm without throwing.
- `MenuBarView.swift` exposes the new `RecallView` alongside the
  existing per-store views.
- A `RecallViewTests` (or equivalent snapshot/unit) test asserts the
  rendering and the semantic-unavailable degradation path.
- `swift build` and `swift test` pass under
  `clients/macos/`.

## Source / Intent

Closing fan-out commit `559d9eed`, which explicitly names "the follow-up
`RecallView` and mobile `RecallScreen` subtasks" as the next consumers
of the just-landed macOS recall seam. The seed commit `30861644` framed
the macOS recall work as a multi-step fan-out (DaemonClient first, view
second) matching the `searchTasks` / `searchHistory` / `searchMemory` /
`searchKnowledge` predecessors.

## Initiative

Cross-store recall surface fan-out — give every operator surface
(Telegram, CLI, daemon HTTP, web, macOS, mobile) one unified search
across knowledge / memory / history / tasks instead of per-store
queries.

## Acceptance Evidence

- `clients/macos/Sources/KotaMenuBar/RecallView.swift` plus its
  test file.
- A run-directory transcript or screenshot of the menu-bar `Recall`
  tab returning hits across at least two source arms for a real
  query, plus the `semantic_unavailable` notice rendered when the
  daemon responds with `ok: false`.
- `swift build` and `swift test` output captured in the run
  directory.
