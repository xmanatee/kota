---
id: task-add-mobile-retractscreen-consuming-a-new-daemoncli
title: Add mobile RetractScreen consuming a new DaemonClient.retract
status: ready
priority: p2
area: client
summary: Add a mobile RetractScreen at clients/mobile/src/screens/RetractScreen.tsx that calls POST /retract through a new DaemonClient.retract, exposes retract state on DaemonContext, and renders the four discriminated RetractResult arms (success across the four record arms memory/knowledge/tasks/inbox, no_contributors, not_found, contributor_failed) with a target picker, typed-per-target identifier control, and a confirmation gate before firing the dangerous mutation; closes the cross-store retract fan-out across CLI, Telegram, web, macOS DaemonClient, macOS RetractView, and mobile.
created_at: 2026-04-28T13:33:41.193Z
updated_at: 2026-04-28T13:33:41.193Z
---

## Problem

The cross-store retract seam is now reachable from the CLI
(`kota retract`), the daemon control server (`POST /retract` and
`POST /api/retract`, both sharing `createRetractRouteHandler`), Telegram
(`/retract-<store>` commands, commit `9ba14254`), the web client
(`RetractPanel` consuming `DaemonControlClient.retract.retract`, commit
`e24bf8e3`), the macOS menu-bar contract layer (commit `600b553f`:
`DaemonClient.retract(request:)` plus discriminated `RetractTarget`,
`RetractRequest`, `RetractRecord`, and `RetractResult` mirrors and
`renderRetractResultPlain` in `Models.swift`), and the macOS menu-bar
SwiftUI surface (commit `2ce50f6a`: `RetractView.swift` plus
`MenuBarView` mount and `AppState` retract observables).

Mobile is the only registered operator surface still missing a way to
issue a typed retract against the cross-store seam. The existing mobile
screens (`CaptureScreen`, `RecallScreen`, `AnswerScreen`,
`AnswerHistoryScreen`, `KnowledgeScreen`, `MemoryScreen`,
`TaskSearchScreen`, `HistoryScreen`) all consume the symmetric write/
read seams, but the symmetric correction-side surface is missing on
mobile — an operator on a phone who notices a wrong record has to drop
into the CLI, switch to Telegram, open the web dashboard, or reach for
a Mac to remove it. The seam was designed to remove exactly that
asymmetry on every operator surface; mobile is the only surface where
it still exists.

## Desired Outcome

The mobile client gains a `RetractScreen` — a navigation-mounted screen
modeled after `CaptureScreen` (the closest sibling: same dangerous-
mutation posture, same target-first input shape, same four-arm
discriminated render) — and the mobile `DaemonClient` gains a
`retract(request)` method that calls `POST /retract` and returns the
same discriminated `RetractResult` envelope the macOS
`DaemonClient.retract` already returns. `DaemonContext` exposes
`retractTarget`, `retractIdentifier`, `retractResult`, `retractLoading`,
`retractError`, `retractConfirmed`, plus a `retract(request)` action
matching the capture/recall/answer fan-out shape, with reducer coverage
on the new actions.

- A target picker exposes exactly the registered `RetractTarget`
  values (`memory` / `knowledge` / `tasks` / `inbox`) ordered the way
  `RETRACT_TARGET_ORDER` orders them. There is no `auto` option — the
  seam never picks a target on retract, and the mobile surface must
  mirror that contract literally rather than inventing a classifier the
  seam does not expose.
- The identifier control is typed against the chosen target's arm of
  `RetractRequest` — a labeled input for `id` (memory, tasks), `slug`
  (knowledge), or `path` (inbox). Switching the target resets the
  identifier draft so a knowledge `slug` cannot be submitted as a
  memory `id`. The view narrows on the picker value through an
  exhaustive switch over `RetractTarget` with no `default` branch —
  adding a fifth contributor surfaces as a TypeScript exhaustiveness
  error rather than a runtime branch the screen silently drops.
- Empty / whitespace identifiers do not fire a request; the submit
  affordance stays disabled until both target and identifier are set,
  matching how `CaptureScreen` gates its submit button on a non-empty
  text.
- A confirmation step gates the actual mutation: the first submit
  draft surfaces a confirmation prompt next to the submit button; a
  second submit on the same draft executes the request, mirroring how
  `RetractPanel.tsx` already gates the dashboard surface against the
  seam's `dangerous` risk classification, and how `RetractView.swift`
  gates the macOS surface. Changing the target or identifier
  invalidates the confirmation, forcing a fresh acknowledgement.
- Calls `client.retract(request)` and renders the result through a new
  mobile `retractRender.ts` (parallel to `captureRender.ts`) that
  exports `renderRetractResultPlain` and `renderRetractRecordPlain`
  mirroring `src/modules/retract/render.ts:23-48` line-for-line, plus a
  `RETRACT_TARGET_TINT` table reusing the per-target tints already
  established by `CAPTURE_TARGET_TINT` (`knowledge` blue, `memory`
  purple, `tasks` orange, `inbox` green). The TSX layer owns only
  layout, target badges, and the picker / identifier-control / confirm
  / submit affordances.
- Renders all four `RetractResult` arms with a clear target badge:
  - `success` on each of the four record arms — `memory` / `knowledge`
    show the `recordId`; `tasks` shows the `previousPath -> path` move
    plus the `toState` badge so the surface reads "moved to dropped",
    not "deleted"; `inbox` shows the `recordId` plus the `path`.
  - `no_contributors` shows the same unconfigured notice the CLI / web
    / Telegram / macOS surfaces render.
  - `not_found` shows the named `target` plus the submitted
    `identifier` verbatim and a fixed "no record found" message — no
    auto-retry into a different store.
  - `contributor_failed` shows the offending `target` plus the
    contributor's `message` verbatim.
- Surfaces the `ok: false` arms as user-facing notices (no thrown error
  on any of the three failure arms), matching how `CaptureScreen` and
  the Telegram `/retract-<store>` reply degrade.
- Wired into `clients/mobile/src/navigation/index.tsx` next to
  `CaptureScreen` so the symmetric write/correction pair sits side by
  side in the navigation stack, mirroring how `RetractPanel` mounts
  next to `CapturePanel` in the web sidebar and how `RetractView` mounts
  next to `CaptureView` in the macOS menu bar.

## Constraints

- One mechanism. The screen consumes the existing daemon HTTP route
  (`POST /retract`, `src/modules/retract/routes.ts`) exactly the way the
  web client and macOS client consume it; it does not introduce a
  second removal path, a second per-target dispatcher, or a second
  renderer for `RetractResult`. The agent-callable `retract` tool's
  `dangerous` risk classification is a module-internal detail — the
  screen never inspects or surfaces it.
- Build on the existing `DaemonContext`, navigation map, mobile
  `DaemonClient`, and screen composition. Do not add a parallel state
  container, navigation stack, or HTTP client just for retract.
- Mirror the macOS `DaemonClient.retract` decode discipline: same
  discriminated envelope, same loud rejection of unknown targets /
  unknown reasons / malformed records, same per-target arms.
  Specifically, decode `record.target` as a closed enum and reject any
  other value; require `recordId` on every success arm, `previousPath`/
  `path`/`toState` on the `tasks` arm, `path` on the `inbox` arm; reject
  success payloads that flatten the four arms or omit fields. No
  nullable identifier fields on the wire — every arm carries exactly
  its required identifier.
- Match the per-screen interaction discipline of `CaptureScreen` and
  `RecallScreen` (loading / error / empty / quiet states; no eager fetch
  when the daemon is offline; the confirmation-gated submit replaces
  pull-to-refresh because retracting twice in sequence would re-submit
  a destructive mutation against a different identifier).
- Reuse the existing per-target tints from `CAPTURE_TARGET_TINT` rather
  than inventing a new badge palette for retract; either re-export
  through the new `retractRender.ts` or factor the table into a shared
  helper if the duplication grows. No third tint vocabulary.
- Expose the new types (`RetractTarget`, `RetractRequest`,
  `RetractRecord`, `RetractResult`, `RETRACT_TARGET_ORDER`) on
  `clients/mobile/src/types.ts` mirroring the existing capture types,
  and add the `retract(request)` method on the mobile `DaemonClient`
  alongside the existing seam methods. Do not duplicate the `kota-
  client.ts` declarations — re-derive the same shape on the mobile side
  the way `CaptureRequest`/`CaptureResult` already do.
- Keep `RetractScreen.tsx` under the mobile-side size norm of the
  closest sibling screen (`CaptureScreen.tsx` ≈ 300 lines).
- Confirmation is a screen-local concern; do not add a second approval
  surface on top of the daemon's existing approval queue. The seam's
  `dangerous` risk classification governs the agent path, not the
  operator-driven mobile path.
- No web / Telegram / CLI / macOS / Slack changes in this task — Slack
  `/retract` is a sibling follow-up that extends the existing
  `task-extend-slack-channel-slash-command-parity-to-*` cluster and
  stays out of scope here.

## Done When

- `clients/mobile/src/screens/RetractScreen.tsx` exists, renders the
  four `RetractResult` arms with target-aware feedback, and handles all
  three `ok: false` arms without throwing.
- `clients/mobile/src/retractRender.ts` exports
  `renderRetractRecordPlain`, `renderRetractResultPlain`, and a
  `RETRACT_TARGET_TINT` table whose line shape and tint vocabulary
  match `src/modules/retract/render.ts` and `captureRender.ts`
  respectively.
- `clients/mobile/src/types.ts` exposes `RetractTarget`,
  `RetractRequest`, `RetractRecord`, `RetractResult`, and
  `RETRACT_TARGET_ORDER`, structurally identical to the
  `kota-client.ts` declarations.
- `clients/mobile/src/daemonClient.ts` exposes `retract(request)` that
  calls `POST /retract` and returns the discriminated `RetractResult`
  envelope, with loud rejection on malformed payloads matching the
  decode discipline of the existing `capture` / `recall` / `answer`
  methods.
- `clients/mobile/src/context/DaemonContext.tsx` (and the matching
  state/reducer module) exposes `retractTarget`, `retractIdentifier`,
  `retractResult`, `retractLoading`, `retractError`,
  `retractConfirmed`, plus setters and a `retract(request)` action;
  reset behavior matches the existing capture observables (cleared on a
  fresh request, on target change, and on the existing `reset()` path).
- `clients/mobile/src/navigation/index.tsx` registers the new screen
  next to `CaptureScreen`.
- A `RetractScreen.test.tsx` (sibling to the existing
  `CaptureScreen.test.tsx` in
  `clients/mobile/src/__tests__/`) asserts the rendering across the
  four arms, the per-target identifier-control narrowing, the
  confirmation gate, and the empty-identifier disabled-submit guard.
  Because there is no fan-out from this task, the tests live in the
  existing mobile test target — do not add a new test target.
- `pnpm --filter kota-mobile typecheck` (or whatever the mobile
  package's standard typecheck script is) and `pnpm --filter kota-
  mobile test` are green.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped macOS `RetractView`
(commit `2ce50f6a`), which landed the fifth operator surface for the
cross-store retract seam (`546cacab`) after the `kota retract` CLI
subcommand, the daemon `POST /retract` and `POST /api/retract` routes,
the `KotaClient.retract.retract` namespace, the agent-callable `retract`
tool, the Telegram `/retract-<store>` commands (`9ba14254`), the web
`RetractPanel` (`e24bf8e3`), and the macOS `DaemonClient.retract`
contract layer (`600b553f`).

The seam task
(`task-add-a-unified-cross-store-retract-seam-mirroring-c`) explicitly
scoped Telegram, web, macOS, and mobile adoption out of the seam itself
and called for them to land later as honest single-task follow-ups (see
the "No fan-out from this module" boundary in
`src/modules/retract/AGENTS.md`). The macOS view task
(`task-add-macos-menu-bar-retractview-consuming-daemoncli`) explicitly
named "mobile DaemonClient.retract and RetractScreen are the next two
parallel follow-ups in the cross-store retract fan-out" — bundling both
into one mobile task here matches the cadence the recall, answer,
answer-history, and capture seams already followed on mobile, where the
contract layer plus screen plus DaemonContext wiring live in one task
because the mobile package shares `DaemonClient` with the screen layer
(unlike macOS, where the SwiftUI view and the Codable contract layer
sit in different files and bundling repeatedly timed out builder runs
at ~17 minutes). This task mirrors the
`task-add-mobile-capturescreen-consuming-a-new-daemoncli` template
one-to-one for the cross-store retract surface, with the picker
adjusted from "auto + four targets" to "four targets only" (no
classifier on retract), the identifier control adjusted from "free-form
text + optional hint" to the typed `{id|slug|path}` discriminated draft,
the response render adjusted to the four-arm `RetractResult` envelope,
and a confirmation step added to mirror the dashboard / macOS surfaces'
gate against the seam's dangerous risk classification.

## Initiative

Cross-store retract fan-out: deliver the unified retract seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile) so
a single typed correction entry is reachable wherever the operator is
watching, mirroring the capture, recall, answer, and answer-history
chains already fanned out across the same surfaces. This task lands the
final operator-surface fan-out for retract — the mobile screen plus
its DaemonClient contract.

## Acceptance Evidence

- Diff covering the new `RetractScreen.tsx`, `retractRender.ts`, the
  `types.ts` retract type additions, the `daemonClient.ts`
  `retract(request)` method, the `DaemonContext` retract observables and
  `retract(request)` action, the navigation registration, and the new
  `RetractScreen.test.tsx`.
- A run-directory transcript or screenshot of the mobile `Retract`
  screen returning each of the four `RetractResult` arms for
  representative inputs (one filesystem-backed success arm — `tasks`
  with `previousPath -> path` plus the `toState` badge, or `inbox` with
  `path` — so the per-record body shape is visible; `no_contributors`;
  `not_found` with the submitted identifier echoed verbatim;
  `contributor_failed` with a real error message).
- A short rendered-output sample (line shape) from the mobile
  `RetractScreen` next to the equivalent `kota retract` CLI output, the
  web `RetractPanel` body, and the macOS `RetractView` body proving
  line-shape parity for at least two arms, captured under
  `.kota/runs/<run-id>/`.
- Mobile typecheck and test output captured in the run directory
  showing the new test cases passing alongside the existing mobile
  test suite.
