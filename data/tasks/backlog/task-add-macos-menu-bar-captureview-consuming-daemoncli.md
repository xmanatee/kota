---
id: task-add-macos-menu-bar-captureview-consuming-daemoncli
title: Add macOS menu-bar CaptureView consuming DaemonClient.capture
status: backlog
priority: p2
area: modules
summary: Add a SwiftUI menu-bar CaptureView in clients/macos/Sources/KotaMenuBar/ that consumes the just-landed DaemonClient.capture and renders the four discriminated CaptureResult arms with target-aware feedback, closing macOS parity in the cross-store capture fan-out.
created_at: 2026-04-28T05:27:25.549Z
updated_at: 2026-04-28T05:27:25.549Z
---

## Problem

The cross-store capture seam is now reachable from the CLI
(`kota capture`), the daemon (`POST /capture`, `POST /api/capture`),
Telegram (`/capture` plus the four `/capture-to-*` twins,
commit `d4c35d1e`), and the web client (`CapturePanel`,
commit `d9d34b89`). The macOS menu-bar app got the contract layer in
commit `33595c0a` (`DaemonClient.capture` + discriminated
`CaptureRecord` and `CaptureResult` enums + `renderCaptureResultPlain`
+ four `DaemonClientTests` capture cases), but the menu bar still
has no SwiftUI view that lets the operator actually drop a free-form
note in and route it through the classifier.

As a result, the macOS surface still forces the operator into per-
store views (`KnowledgeView`, `MemoryView`, `HistoryView`,
`TaskSearchView`) for what should be one unified capture, the same
gap the capture seam was built to close on every other surface.

## Desired Outcome

Add a `CaptureView` SwiftUI view at
`clients/macos/Sources/KotaMenuBar/CaptureView.swift`, modeled after
the existing `RecallView` and `AnswerView`:

- Multi-line text input plus a target picker (memory / knowledge /
  tasks / inbox / "auto") plus an optional hint input plus a submit
  affordance, with debounced re-issue on submit (no auto-capture
  on keystroke).
- Calls `DaemonClient.shared.capture(text:target:hint:)` and renders
  the result.
- Renders all four `CaptureResult` arms with a clear target badge:
  `success` on each of the four record arms (memory / knowledge /
  tasks / inbox; the filesystem-backed arms surface the `path`
  alongside the `recordId`); `ambiguous` with the suggestion list
  and a hint pointing at the picker; `no_contributors` with the
  same unconfigured notice the CLI / web / Telegram surfaces
  render; `contributor_failed` with the target plus the verbatim
  error message.
- Surfaces the `ok: false, reason: "no_contributors"` arm as a
  user-facing notice (no thrown error), matching how
  `CapturePanel` and the Telegram `/capture` reply degrade.
- Wired into `MenuBarView` in the same place as the other per-
  store views, so the operator can select "Capture" alongside
  Recall / Answer / Knowledge / Memory / History / Tasks.

## Constraints

- Single new view file plus a `MenuBarView` integration edit; do
  not refactor the existing per-store views in this task.
- Reuse `renderCaptureResultPlain` (already added to the macOS
  module in commit `33595c0a`) rather than re-implementing the
  rendering logic in SwiftUI; the SwiftUI layer should focus on
  layout, target badges, and the picker / hint controls.
- Do not introduce a new request shape or HTTP route —
  `DaemonClient.capture` already targets `POST /capture`, and the
  response contract already lives in `Models.swift`.
- Keep the file under the macOS-side size norm of the peer views
  (`RecallView.swift` is the closest sibling).
- No web / Telegram / CLI / mobile changes in this task — mobile
  `CaptureScreen` is a separate parallel follow-up.

## Done When

- `clients/macos/Sources/KotaMenuBar/CaptureView.swift` exists,
  renders the four `CaptureResult` arms with target-aware feedback,
  and handles the `ok: false, reason: "no_contributors"` arm
  without throwing.
- `MenuBarView.swift` exposes the new `CaptureView` alongside the
  existing per-store views.
- A `CaptureViewTests` (or equivalent snapshot/unit) test asserts
  the rendering across the four arms and the no-contributors
  degradation path.
- `swift build` and `swift test` pass under `clients/macos/`.

## Source / Intent

Closing fan-out commit `33595c0a`, which explicitly names "the
follow-up macOS `CaptureView` and mobile `CaptureScreen` subtasks"
as the next consumers of the just-landed macOS capture seam. The
seed commit `805a6edf` framed the macOS capture work as a multi-step
fan-out (DaemonClient first, view second) matching the recall and
answer predecessors (`559d9eed` → `b7ea172b` for recall;
`647ddb85` → `70308aab` for answer).

## Initiative

Cross-store capture surface fan-out — give every operator surface
(Telegram, CLI, daemon HTTP, web, macOS, mobile) one unified
capture entry that routes a free-form note into the right store
instead of picking a per-store screen up front.

## Acceptance Evidence

- `clients/macos/Sources/KotaMenuBar/CaptureView.swift` plus its
  test file.
- A run-directory transcript or screenshot of the menu-bar
  `Capture` tab returning each of the four `CaptureResult` arms
  for representative inputs (one filesystem-backed success arm so
  the `path` is visible; ambiguous with at least two suggestions;
  the no-contributors notice; contributor-failed with a real
  error message).
- `swift build` and `swift test` output captured in the run
  directory.
