---
id: task-add-macos-menu-bar-retractview-consuming-daemoncli
title: Add macOS menu-bar RetractView consuming DaemonClient.retract
status: done
priority: p2
area: client
summary: Add a SwiftUI menu-bar RetractView at clients/macos/Sources/KotaMenuBar/RetractView.swift that consumes the just-landed DaemonClient.retract(request:) and renders the four discriminated RetractResult arms (success across the four record arms, no_contributors, not_found, contributor_failed) with target-aware feedback, target-first picker, per-arm identifier control, and a confirmation step before firing the dangerous mutation; mount in MenuBarView and wire AppState retract observables — closing macOS parity in the cross-store retract fan-out before mobile DaemonClient.retract and RetractScreen land as the final two steps.
created_at: 2026-04-28T12:59:37.218Z
updated_at: 2026-04-28T13:11:10.301Z
---

## Problem

The cross-store retract seam is now reachable from the CLI
(`kota retract`), the daemon (`POST /retract` and `POST /api/retract`,
both sharing `createRetractRouteHandler`), Telegram (`/retract-<store>`
commands, commit `9ba14254`), the web client (`RetractPanel`
consuming `DaemonControlClient.retract.retract`, commit `e24bf8e3`),
and now the macOS menu-bar contract layer (commit `600b553f`:
`DaemonClient.retract(request:)` + discriminated `RetractTarget`,
`RetractRequest`, `RetractRecord`, and `RetractResult` mirrors plus
`renderRetractResultPlain` in `Models.swift`, with four
`DaemonClientTests` cases pinning the wire decode against the daemon's
exact response contract).

The macOS menu bar still has no SwiftUI view that lets the operator
actually issue a typed retract. Capture, recall, answer, and answer-
history all expose a menu-bar surface alongside the per-store views,
but the symmetric correction-side surface is missing on macOS — an
operator on a Mac who notices a wrong record has to drop into the CLI,
switch to Telegram, or open the web dashboard to remove it. The seam
was designed to remove exactly that asymmetry on every operator
surface; macOS is the only surface where it still exists after the
contract layer landed.

## Desired Outcome

Add a `RetractView` SwiftUI view at
`clients/macos/Sources/KotaMenuBar/RetractView.swift`, modeled after
the existing `CaptureView` (the closest sibling: same dangerous-
mutation posture, same target-first input shape, same four-arm
discriminated render):

- A target picker exposes exactly the registered `RetractTarget`
  values (`memory` / `knowledge` / `tasks` / `inbox`) ordered the way
  `CaptureTargetChoice` orders the equivalent capture choices. There
  is no `auto` option — the seam never picks a target on retract, and
  the SwiftUI surface must mirror that contract literally rather than
  inventing a classifier the seam does not expose.
- The identifier control is typed against the chosen target's arm of
  `RetractRequest` — a labeled input for `id` (memory, tasks), `slug`
  (knowledge), or `path` (inbox). Switching the target resets the
  identifier draft so a knowledge `slug` cannot be submitted as a
  memory `id`. The SwiftUI surface narrows on the picker value
  through an exhaustive switch over `RetractTarget` with no
  `default` branch — adding a fifth contributor must surface as a
  Swift switch-exhaustiveness error rather than a runtime branch the
  view silently drops.
- Empty / whitespace identifiers do not fire a request; the submit
  affordance stays disabled until both target and identifier are
  set, matching how `CaptureView` gates the submit button.
- A confirmation step gates the actual mutation: the first submit
  draft surfaces a confirmation prompt next to the submit button;
  a second submit on the same draft executes the request, mirroring
  how `RetractPanel.tsx` already gates the dashboard surface against
  the seam's `dangerous` risk classification. Changing the target or
  identifier invalidates the confirmation, forcing a fresh
  acknowledgement.
- Calls `DaemonClient.shared.retract(request:)` and renders the
  result through `renderRetractResultPlain` (already added to
  `Models.swift` in commit `600b553f`) for the per-arm body text,
  with the SwiftUI layer owning only layout, target badges, and the
  picker / identifier-control / confirm / submit affordances.
- Renders all four `RetractResult` arms with a clear target badge:
  - `success` on each of the four record arms — `memory` /
    `knowledge` show the `recordId`; `tasks` shows the
    `previousPath -> path` move plus the `dropped` state badge so
    the surface reads "moved to dropped", not "deleted"; `inbox`
    shows the `recordId` plus the `path`.
  - `no_contributors` shows the same unconfigured notice the CLI /
    web / Telegram surfaces render.
  - `not_found` shows the named `target` plus the submitted
    `identifier` verbatim and a fixed "no record found" message —
    no auto-retry into a different store.
  - `contributor_failed` shows the offending `target` plus the
    contributor's `message` verbatim.
- Surfaces the `ok: false` arms as user-facing notices (no thrown
  error on any of the three failure arms), matching how
  `CaptureView` and the Telegram `/retract-<store>` reply degrade.
- Wired into `MenuBarView` next to `CaptureView` so the symmetric
  write/correction pair sits side by side, mirroring how
  `RetractPanel` mounts next to `CapturePanel` in the web sidebar.
- `AppState` exposes `retractTarget`, `retractIdentifier`,
  `retractResult`, `retractError`, `isLoadingRetract`, plus the
  `retractConfirmed` flag the confirmation step toggles, and a
  `loadRetract()` method shaped like `loadCapture()` that builds
  the `RetractRequest` from the picker + identifier draft and
  consumes `DaemonClient.shared.retract(request:)`. Reset behaviour
  matches `captureResult` (cleared on a fresh request, on target
  change, and on the existing `reset()` path).

## Constraints

- One mechanism. The view consumes the existing
  `DaemonClient.retract(request:)` namespace exactly the way
  `CaptureView` consumes its seam; it does not introduce a second
  removal path, a second per-target dispatcher, or a second renderer
  for `RetractResult`. The agent-callable `retract` tool's
  `dangerous` risk classification is a module-internal detail — the
  view never inspects or surfaces it.
- Single new view file plus a `MenuBarView` integration edit plus the
  `AppState` retract* observable additions; do not refactor the
  existing per-store views, `CaptureView`, or the recall / answer
  views in this task.
- Reuse `renderRetractResultPlain` (already in `Models.swift`) rather
  than re-implementing the rendering logic in SwiftUI; SwiftUI owns
  layout, target badges, and the picker / identifier-control /
  confirm / submit controls, not the per-arm body text.
- Do not introduce a new request shape or HTTP route —
  `DaemonClient.retract(request:)` already targets `POST /retract`,
  and the response contract already lives in `Models.swift`.
- The target picker and identifier-control mapping are exhaustive
  against `RetractTarget` at compile time. No `default` branch in
  the per-target identifier control or in the result render.
- Reuse the existing per-target tints already established by
  `RecallSourceBadge` (`knowledge` blue, `memory` purple, `tasks`
  orange) and the `inbox` tint introduced for `CaptureView` (`teal`)
  so the surface stays visually consistent across capture, recall,
  answer, and retract; do not invent a new badge palette for retract.
- Keep the file under the macOS-side size norm of the closest
  sibling view (`CaptureView.swift` is 331 lines).
- Confirmation is a view-local concern; do not add a second approval
  surface on top of the daemon's existing approval queue. The seam's
  `dangerous` risk classification governs the agent path, not the
  operator-driven menu-bar path.
- No web / Telegram / CLI / mobile changes in this task — mobile
  `DaemonClient.retract` and `RetractScreen` are the next two
  parallel follow-ups in the cross-store retract fan-out and stay
  out of scope here.

## Done When

- `clients/macos/Sources/KotaMenuBar/RetractView.swift` exists,
  renders the four `RetractResult` arms with target-aware feedback,
  and handles all three `ok: false` arms without throwing.
- `MenuBarView.swift` mounts the new `RetractView` next to
  `CaptureView` (the symmetric write / correction pair sits side by
  side).
- `AppState.swift` exposes `retractTarget`, `retractIdentifier`,
  `retractResult`, `retractError`, `isLoadingRetract`,
  `retractConfirmed`, and `loadRetract()`, with reset behaviour
  matching the existing capture observables.
- A `RetractViewTests` (or equivalent unit / snapshot) test asserts
  the rendering across the four arms, the per-target identifier-
  control narrowing, and the confirmation gate. Because there is no
  fan-out from this task, the tests live in the existing
  `KotaMenuBarTests` target alongside the already-shipped
  `DaemonClientTests` retract cases — do not add a new test target.
- `swift build` and `swift test` pass under `clients/macos/`.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped macOS
`DaemonClient.retract` (commit `600b553f`), which landed the contract
layer the macOS view layer needs and which explicitly named "the
follow-up macOS `RetractView` and mobile `RetractScreen` subtasks"
as the next consumers of the just-landed retract seam. The seam task
(`task-add-a-unified-cross-store-retract-seam-mirroring-c`) and the
macOS DaemonClient task
(`task-add-macos-daemonclientretract-with-discriminated-r`) both
explicitly scoped the macOS view and the mobile fan-out out of the
contract layer and called for them to land later as honest single-
task follow-ups (see the "No fan-out from this module" boundary in
`src/modules/retract/AGENTS.md`).

The cadence Telegram → web → macOS DaemonClient → macOS view → mobile
DaemonClient → mobile screen is the same cadence the recall, answer,
answer-history, and capture seams already followed — separate
contract task → view task → mobile task, never bundled, because
bundling repeatedly timed out builder runs at ~17 minutes when the
contract layer plus SwiftUI view plus AppState wiring plus operator
capture were combined. This task mirrors the
`task-add-macos-menu-bar-captureview-consuming-daemoncli` template
one-to-one for the cross-store retract surface, with the picker
adjusted from "auto + four targets" to "four targets only" (no
classifier on retract), the identifier control adjusted from
"free-form text + optional hint" to the typed
`{id|slug|path}` discriminated draft, the response render adjusted
to the four-arm `RetractResult` envelope, and a confirmation step
added to mirror the dashboard surface's gate against the seam's
dangerous risk classification.

## Initiative

Cross-store retract fan-out: deliver the unified retract seam
through every operator surface (CLI, Telegram, web, macOS menu bar,
mobile) so a single typed correction entry is reachable wherever the
operator is watching, mirroring the capture, recall, answer, and
answer-history chains already fanned out across the same surfaces.
This task lands the macOS-side SwiftUI surface for that seam.

## Acceptance Evidence

- Diff covering the new `RetractView.swift`, the `MenuBarView.swift`
  integration edit, the `AppState.swift` retract observable
  additions and `loadRetract()` method, and the new
  `RetractViewTests` (or equivalent) cases.
- A run-directory transcript or screenshot of the menu-bar
  `Retract` tab returning each of the four `RetractResult` arms for
  representative inputs (one filesystem-backed success arm — `tasks`
  with `previousPath -> path` plus the `dropped` state badge, or
  `inbox` with `path` — so the per-record body shape is visible;
  `no_contributors`; `not_found` with the submitted identifier
  echoed verbatim; `contributor_failed` with a real error message).
- A short rendered-output sample (line shape) from the `RetractView`
  next to the equivalent `kota retract` CLI output and the web
  `RetractPanel` body proving line-shape parity for at least two
  arms, captured under `.kota/runs/<run-id>/`.
- `swift build` and `swift test` output captured in the run
  directory.
