---
id: task-add-mobile-capturescreen-consuming-a-new-daemoncli
title: Add mobile CaptureScreen consuming a new DaemonClient.capture
status: ready
priority: p2
area: client
summary: Add a CaptureScreen in the mobile client that calls POST /api/capture through a new DaemonClient.capture, exposes capture state on DaemonContext, and renders the four discriminated CaptureResult arms (success memory/knowledge/tasks/inbox, ambiguous, no_contributors, contributor_failed), closing the cross-store-capture fan-out across Telegram, daemon HTTP, web, macOS DaemonClient, and mobile.
created_at: 2026-04-28T05:27:20.245Z
updated_at: 2026-04-28T05:27:20.245Z
---

## Problem

The cross-store capture seam is now reachable from the CLI
(`kota capture <text>`), the daemon control server (`POST /capture`),
the user-facing HTTP server (`POST /api/capture`), Telegram
(`/capture` plus the four `/capture-to-{memory,knowledge,tasks,inbox}`
twins, commit `d4c35d1e`), the web client
(`CapturePanel` consuming `DaemonControlClient.capture.capture`,
commit `d9d34b89`), and the macOS menu-bar `DaemonClient.capture`
contract layer (commit `33595c0a`).

Mobile is the only registered operator surface that still has no way
to issue a capture against the cross-store seam. The existing mobile
screens (`KnowledgeScreen`, `MemoryScreen`, `TaskSearchScreen`,
`HistoryScreen`) all read the per-store data, but no screen lets an
operator drop a free-form note in and have it routed through the
classifier to the right store. This is the same cross-surface gap
the capture seam was built to close, and mobile is the final fan-out
step before the cadence Telegram → web → macOS DaemonClient → mobile
is complete for cross-store capture (the macOS `CaptureView` is a
parallel sibling task that lands the SwiftUI surface).

## Desired Outcome

The mobile client gains a `CaptureScreen` — a navigation-mounted
screen mirroring the shape of the existing `RecallScreen` and
`AnswerScreen` — with a multi-line text input, an optional target
picker (memory / knowledge / tasks / inbox / "auto"), an optional
hint input, a submit affordance, and a result panel that renders all
four `CaptureResult` arms. The mobile `DaemonClient` gains a
`capture(text, options)` method that calls `POST /api/capture` and
returns the same discriminated `CaptureResult` envelope the macOS
`DaemonClient.capture` already returns. `DaemonContext` exposes
`captureText`, `captureTarget`, `captureHint`, `captureResult`,
`captureLoading`, `captureError`, and `capture(text, options)`
matching the recall/answer fan-out shape, with reducer coverage on
the new actions.

The four operator-visible branches surface one-to-one with the
daemon contract:

- `ok: true, record: CaptureRecord` — render a success body with
  the target badge, the typed `recordId`, and the `path` for the
  filesystem-backed `tasks`/`inbox` arms.
- `ok: false, reason: "ambiguous"` — render the suggestion list and
  a hint that the operator can re-issue with an explicit target via
  the picker (the mobile equivalent of the CLI `--target` flag).
- `ok: false, reason: "no_contributors"` — render the same
  unconfigured notice the CLI / web / macOS surfaces render so the
  operator can distinguish "the seam is unconfigured" from any
  other failure shape.
- `ok: false, reason: "contributor_failed"` — render the target
  and the verbatim error message; never coerce into a different
  store.

A whitespace-only / empty-text input shows an inline usage hint and
skips the request, matching the recall / answer screens.

## Constraints

- Build on the existing `DaemonContext`, navigation map, mobile
  `DaemonClient`, and screen composition. Do not add a parallel
  state container, navigation stack, or HTTP client just for
  capture.
- Reuse the same daemon HTTP route the web client consumes
  (`POST /api/capture`, `src/modules/capture/routes.ts:87-97`). Do
  not introduce a second capture route, response shape, or
  rendering helper on the mobile side.
- Mirror the macOS `DaemonClient.capture` decode discipline (commit
  `33595c0a`): same discriminated envelope, same loud rejection of
  unknown reasons / malformed records, same per-target arms.
  Specifically, decode `record.target` as a closed enum and reject
  any other value; require `recordId` on every success arm and
  `path` on the `tasks`/`inbox` arms; reject success payloads that
  flatten the four arms or omit fields.
- Match the per-screen interaction discipline of `RecallScreen`
  and `AnswerScreen` (loading / error / empty / quiet states; no
  eager fetch when the daemon is offline; pull-to-refresh re-runs
  the last submission). Do not auto-submit on each keystroke.
- Reuse `renderCaptureResultPlain` from
  `src/modules/capture/render.ts:38-50` rather than re-implementing
  the rendering logic in TSX; the React Native layer should focus
  on layout, target badges, and the picker/hint controls. Either
  share the helper across the language boundary by re-deriving the
  same line shape from the typed result on the mobile side, or
  factor a small typed renderer that both surfaces can call —
  whichever produces fewer moving parts. No third format. The
  CLI/web body (`renderCaptureResultPlain`) is the canonical mobile
  body; do not mirror the chat-surface variant
  `renderCaptureReplyPlain` — that is Telegram-specific.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the
  new reducer actions rather than relaxing existing assertions.
- The optional `target` and `hint` collapse into the request body
  only when set; a nil target/hint omits the corresponding key so
  the seam applies its own defaults (classifier picks; no hint
  passed). Do not send `null` keys. When both are nil the request
  omits `filter` entirely. Mirror the macOS `DaemonClient.capture`
  serialization one-to-one.
- Single new screen + new `DaemonClient.capture` method + reducer
  + navigation edit + types edit. Do not refactor the recall /
  answer screens or DaemonClient methods in this task.

## Done When

- `clients/mobile/src/screens/CaptureScreen.tsx` renders the
  `CaptureScreen`, registered in the navigation map and reachable
  alongside `RecallScreen`, `AnswerScreen`, `KnowledgeScreen`,
  `MemoryScreen`, `HistoryScreen`, `TaskSearchScreen`.
- The mobile `DaemonClient` adds a `capture(text, options)` method
  against `POST /api/capture`, returning the same discriminated
  `CaptureResult` envelope as the macOS / web surfaces, with a
  typed mirror in `clients/mobile/src/types.ts` that matches the
  four `CaptureRecord` arms and the four `CaptureResult` arms in
  `src/core/server/kota-client.ts:758-846`.
- `DaemonContext` exposes `captureText`, `captureTarget`,
  `captureHint`, `captureResult`, `captureLoading`, `captureError`,
  and `capture(text, options)`, matching the recall / answer fan-
  out shape, with reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- `clients/mobile/src/__tests__/CaptureScreen.test.tsx` covers
  the four `CaptureResult` arms (success on at least two record
  arms — one of `memory`/`knowledge` and one of `tasks`/`inbox`
  so both record-shape variants are exercised — plus the three
  `ok: false` arms), the empty-text usage hint, and the error
  state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds
  capture decode coverage matching the macOS `DaemonClientTests`
  capture cases (multi-arm success including `tasks` path,
  `ambiguous` with at least two suggestions, `no_contributors`,
  `contributor_failed` with target + message, plus an unknown-
  reason rejection and a malformed-record rejection).
- The mobile test command and the capture module's tests both
  pass cleanly; no other capture / recall / answer fan-out tests
  regress.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped macOS
`DaemonClient.capture` (commit `33595c0a`), which landed alongside
the cross-store capture seam (`805a6edf`), the `kota capture` CLI
subcommand, the daemon `POST /capture` and `POST /api/capture`
routes (`src/modules/capture/routes.ts`), the
`KotaClient.capture.capture` namespace, the Telegram `/capture`
plus four `/capture-to-*` commands (`d4c35d1e`), and the web
`CapturePanel` (`d9d34b89`).

The seam task
(`task-add-a-unified-cross-store-capture-seam-routing-one`) and the
macOS DaemonClient task
(`task-add-macos-daemonclientcapture-with-discriminated-c`) both
explicitly named "the follow-up macOS `CaptureView` and mobile
`CaptureScreen` subtasks" as the next consumers. The mobile
`searchTasks` (commit `18ba6edf`), `RecallScreen`
(`task-add-mobile-recallscreen-consuming-a-new-daemonclie`), and
`AnswerScreen` (`task-add-mobile-answerscreen-consuming-daemonclie...`)
fan-outs all established the same Telegram → CLI → daemon → web →
macOS → mobile cadence the digest, attention, knowledge, memory,
history, tasks-semantic, recall, and answer seams already follow;
this task is the final mobile-side fan-out for the cross-store
capture surface.

## Initiative

Cross-store capture surface fan-out — give every operator surface
(Telegram, CLI, daemon HTTP, web, macOS, mobile) one unified
capture entry that routes a free-form note into the right store
instead of picking a per-store screen up front. With this task
done, the capture seam reaches the same multi-client parity the
digest, attention, knowledge, memory, history, tasks-semantic,
recall, and answer seams already have, and an operator on a phone
gains direct access to unified cross-store capture without
context-switching to another client.

## Acceptance Evidence

- Mobile test command output showing the new `CaptureScreen`
  reducer, navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile `CaptureScreen`
  rendering each of the four `CaptureResult` arms (at least one
  filesystem-backed success arm so the `path` is visible, the
  `ambiguous` arm with the suggestion list, `no_contributors`,
  and `contributor_failed`), captured under
  `.kota/runs/<run-id>/`.
- A short rendered-output sample (line shape) from the
  `CaptureScreen` next to the equivalent `kota capture` CLI
  output and the web `CapturePanel` body proving line-shape
  parity for at least two arms.
