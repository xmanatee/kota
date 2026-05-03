---
id: task-add-macos-daemonclientanswerloganswershow-and-answ
title: Add macOS DaemonClient.answerLog/answerShow and AnswerHistoryView consuming the persisted answer-history routes
status: done
priority: p3
area: client
summary: Add macOS DaemonClient.answerLog and answerShow methods plus an AnswerHistoryView so the persisted answer-history surface is discoverable on macOS, mirroring the mobile, web, and Telegram answer-log/show fan-out.
created_at: 2026-05-02T23:26:03.049Z
updated_at: 2026-05-03T03:25:42.072Z
---

## Problem

The persisted answer-history surface fanned out to mobile
(`AnswerHistoryScreen` + `daemonClient.answerLog/answerShow`), web
(`AnswerHistoryPanel` + `apiClient.listAnswers/getAnswer`), and
Telegram (`/answer-log` / `/answer-show <id>`). On macOS the Swift
type mirrors are present (`AnswerHistoryEntry`,
`AnswerHistoryRecord`, `AnswerHistoryListResult`,
`AnswerHistoryShowResult`, `AnswerHistoryListFilter` in
`clients/macos/Sources/KotaMenuBar/Daemon/AnswerModels.swift`) and
decode strictly, but `clients/macos/Sources/KotaMenuBar/Daemon/
AnswerRoutes.swift` only exposes `DaemonClient.answer(...)` for
`POST /answer`. There is no `DaemonClient.answerLog` /
`DaemonClient.answerShow` method calling `GET /answers` /
`GET /answers/:id`, and no `AnswerHistoryView` consuming the result.

The macOS operator therefore cannot list or re-read past cited
answers from the menu bar today, even though every other operator
client surfaces that read path.

## Desired Outcome

A macOS operator can open the menu bar, navigate to the answer-
history surface, see a newest-first list of past cited answers, and
tap one to re-render the full record (query, citations, recall hits,
discriminated success/failure result). The IA fits the existing
`AskUnifiedView` / operator-section model rather than introducing a
parallel navigation tree.

## Constraints

- One mechanism. The new methods call the existing daemon-control
  routes (`GET /answers`, `GET /answers/:id`) through the same
  `URLSession` + bearer-auth + JSON-decode pattern other
  `*Routes.swift` files use. No parallel HTTP path.
- The Swift types in `AnswerModels.swift` are already strict; do not
  introduce permissive duplicates. Pass them through.
- The new `AnswerHistoryView` (or section inside `AskUnifiedView`)
  renders the same arms the mobile `AnswerHistoryScreen` renders:
  loading, populated list, populated detail with citations,
  empty-list label, `not_found` banner for show, error banner with
  retry, offline banner.
- Pagination uses `AnswerHistoryListFilter.beforeId` matching the
  daemon route's cursor shape; do not invent a second pagination
  shape.
- Add the macOS read surface to the cross-client conformance
  fixture's `answerHistory.*` arms only if the existing fixture
  rows do not already cover the macOS decoder; the fixture already
  pins `list`, `showFound`, `showNotFound`, and
  `negative_unknownReason`, so most likely no fixture change is
  needed.

## Done When

1. `clients/macos/Sources/KotaMenuBar/Daemon/AnswerRoutes.swift`
   exports `DaemonClient.answerLog(filter:)` returning
   `AnswerHistoryListResult` and `DaemonClient.answerShow(id:)`
   returning `AnswerHistoryShowResult`. Both call the bearer-auth
   daemon-control routes via the existing `URLSession` pattern.
2. A macOS UI surface (a new `AnswerHistoryView.swift` or a section
   inside `AskUnifiedView`) renders the list and detail arms,
   including the `not_found` and error banners.
3. Unit tests under `clients/macos/Tests/KotaMenuBarTests/` cover
   the decode-and-render arms (or extend the existing
   `ContractFixtureTests` with the new call-site coverage).
4. The macOS operator can discover the answer-history surface from
   the menu bar without overloading another mode.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the macOS Swift
   build all pass.

## Source / Intent

Surfaced by the `task-fan-out-consolidation-answers` review
(`.kota/runs/2026-05-02T23-16-15-695Z-builder-c6bbto/answers-
consolidation/verdict.md`, Section 1 — Information architecture).
The integration-test fan-out task
(`task-add-recall-plus-cited-answer-plus-answer-history-e`)
described the answer-history seam as fanning out to "Telegram, web,
macOS, and mobile surfaces", and the Swift type mirrors were
landed, but the macOS `DaemonClient` and UI never followed.
Catch-up rather than a regression — `p3` because the read path is
already available on every other operator surface today.

## Initiative

Module-first, surface-parity hygiene: every operator client surfaces
the same load-bearing capabilities. macOS already has `answer`
(POST), so closing the gap to `answer-log` / `answer-show` keeps
the menu-bar surface honest.

## Acceptance Evidence

- Diff adding the two `DaemonClient` methods and the macOS UI
  surface, plus tests under
  `clients/macos/Tests/KotaMenuBarTests/`.
- Operator-captured screenshot of the macOS menu bar showing the
  populated answer-history list and the detail re-render under
  `.kota/runs/answer-history-macos-screens-<stamp>/macos/`.
- A recorded `swift test` run passing in the diff.
