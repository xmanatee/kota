---
id: task-add-macos-menu-bar-answerview-consuming-daemonclie
title: Add macOS menu-bar AnswerView consuming DaemonClient.answer
status: ready
priority: p2
area: client
summary: Add a SwiftUI menu-bar AnswerView in clients/macos/Sources/KotaMenuBar/ that consumes the just-landed DaemonClient.answer and renders the synthesized answer plus typed citations, closing macOS parity in the cited-answer fan-out alongside the still-pending mobile AnswerScreen.
created_at: 2026-04-27T12:50:58.679Z
updated_at: 2026-04-27T12:50:58.679Z
---

## Problem

The cited-answer seam is now reachable from the CLI (`kota answer`),
the daemon control server (`POST /answer`), the user-facing HTTP twin
(`POST /api/answer`), Telegram (`/answer`, commit `82a544af`), and the
web client (`AnswerPanel`, commit `1d3dcefb`). The macOS menu-bar app
got the contract layer in commit `647ddb85` (`DaemonClient.answer` +
`AnswerCitation` struct + four-arm discriminated `AnswerResult` enum
+ `renderAnswerCitationsPlain` Swift helper + five `DaemonClientTests`
cases), but the menu bar still has no SwiftUI view that lets the
operator actually issue an answer query and see one composed answer
plus typed citations into the second brain. As a result, the macOS
operator who just got `RecallView` (commit `b7ea172b`) for ranked
hits has no way to ask for a synthesized answer with citations on
the same surface — the gap the cited-answer seam was built to close
on every operator surface.

## Desired Outcome

Add an `AnswerView` SwiftUI view at
`clients/macos/Sources/KotaMenuBar/AnswerView.swift`, modeled after
the existing single-tab views (`RecallView`, `TaskSearchView`,
`HistoryView`, etc.):

- Free-text query input plus a submit affordance, with debounced
  re-issue on submit (no auto-search-on-keystroke beyond what those
  peer views already do).
- Calls `DaemonClient.shared.answer(query:topK:minScore:sources:)`
  and renders the result.
- Renders the synthesized `answer` body verbatim (preserving the
  inline `[source:id]` markers) plus a per-citation list with a
  source badge per row, matching the same source-tint mapping
  `RecallSourceBadge` already uses (`knowledge`→blue,
  `memory`→purple, `history`→green, `tasks`→orange) so the macOS
  cited-answer surface stays visually consistent with the recall
  surface and with the web `AnswerPanel`.
- Surfaces all three `ok: false` arms (`reason: "no_hits"`,
  `"semantic_unavailable"`, `"synthesis_failed"`) as user-facing
  notices, mirroring how `AnswerPanel` and the Telegram `/answer`
  reply degrade — never thrown errors.
- Wired into `MenuBarView` in the same place as the other per-store
  views, so the operator can select "Answer" alongside Knowledge /
  Memory / History / Tasks / Recall.

## Constraints

- Single new view file plus a `MenuBarView` integration edit; do not
  refactor the existing per-store views in this task.
- Reuse `renderAnswerCitationsPlain` (already in `Models.swift`,
  byte-for-byte mirror of `src/modules/answer/render.ts:32-53`)
  rather than re-implementing the citation rendering logic in
  SwiftUI; the SwiftUI layer should focus on layout, the source
  badge column, and the answer body.
- Reuse `RecallSourceBadge` for per-citation source tints rather
  than duplicating the four-source color map. If the badge needs to
  move to a shared file, do that move as part of this task; do not
  fork a parallel `AnswerSourceBadge`.
- Do not introduce a new request shape or HTTP route —
  `DaemonClient.answer` already targets `POST /answer`, and the
  response contract already lives in `Models.swift`.
- Add `answerQuery: String`, `answerResult: AnswerResult?`,
  `answerError: String?`, `isLoadingAnswer: Bool`, and a
  `loadAnswer()` method to `AppState.swift`, mirroring the
  `recall*` shape one-to-one (including the reset behavior in the
  same lifecycle methods that already reset `recall*`). Do not add
  a parallel state container.
- Keep the file under the macOS-side size norm of the peer views
  (`RecallView.swift` is 251 lines).
- No web/Telegram/CLI/mobile changes in this task — mobile
  `AnswerScreen` is a separate follow-up.

## Done When

- `clients/macos/Sources/KotaMenuBar/AnswerView.swift` exists,
  renders the synthesized answer body plus a per-citation list with
  source badges, and handles each `ok: false` arm
  (`no_hits`, `semantic_unavailable`, `synthesis_failed`) without
  throwing.
- `MenuBarView.swift` exposes the new `AnswerView` alongside the
  existing per-store views.
- `AppState.swift` carries `answerQuery`, `answerResult`,
  `answerError`, `isLoadingAnswer`, and `loadAnswer()` mirroring
  the `recall*` shape.
- An `AnswerViewTests` (or equivalent snapshot/unit) test asserts
  the rendering against the synthesized-success arm and at least
  one degradation arm.
- `swift build` and `swift test` pass under `clients/macos/`.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped macOS
`DaemonClient.answer` (commit `647ddb85`), which explicitly names
"the follow-up macOS `AnswerView` and mobile `AnswerScreen`
subtasks" as the next consumers of the just-landed contract layer.
The seed task `task-add-a-cited-answer-seam-on-top-of-cross-store-reca`
scoped Telegram, macOS, mobile, and web adoption out of the seam
itself and called for them to land later as honest single-task
follow-ups. Telegram, web, and the macOS contract layer have
landed; the macOS view is the next single substantive step before
the mobile screen closes the fan-out. This task mirrors the
`task-add-macos-menu-bar-recallview-consuming-daemonclie` template
one-to-one for the cited-answer surface, with the route adjusted
from `POST /recall` to `POST /answer` and the response type
adjusted from `RecallSearchResponse` to the four-arm `AnswerResult`.

## Initiative

Personal-assistant answering. KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain on every operator surface, not just the CLI, Telegram, and
web. The macOS menu bar is the natural fourth surface — the same
place the operator already runs `/recall` from a menu-bar view —
and lands the view the mobile `AnswerScreen` follow-up will then
mirror to close the cited-answer fan-out.

## Acceptance Evidence

- `clients/macos/Sources/KotaMenuBar/AnswerView.swift` plus its
  test file.
- A run-directory transcript or screenshot of the menu-bar
  `Answer` tab returning a synthesized answer with citations
  spanning at least two source arms for a real query, plus the
  `no_hits` / `semantic_unavailable` / `synthesis_failed` notice
  rendered when the daemon responds with `ok: false`.
- `swift build` and `swift test` output captured in the run
  directory.
