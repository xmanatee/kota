---
id: task-add-macos-menu-bar-attentionview-consuming-apiatte
title: Add macOS menu bar AttentionView consuming /api/attention
status: ready
priority: p2
area: modules
summary: Add an AttentionView in the macOS menu bar (mirroring DigestView) that calls GET /api/attention and renders the same on-demand attention body the Telegram /attention, kota attention CLI, daemon HTTP route, and web AttentionPanel already share, completing the macOS consumer of the attention-digest on-demand seam.
created_at: 2026-04-26T09:05:42.788Z
updated_at: 2026-04-26T09:05:42.788Z
---

## Problem

The `attention-digest` workflow's on-demand seam (`renderOnDemandAttention`
in `src/modules/autonomy/workflows/attention-digest/step.ts`) now backs
four operator pull-surfaces:

- Telegram `/attention` slash command (commit `3090d2c6`).
- Terminal `kota attention` command (commit `50e12ddf`).
- Daemon HTTP `GET /api/attention` route returning
  `{ data: { items: AttentionItem[] }, text: string }` (commit `50a217fa`).
- Embedded web `AttentionPanel` consuming the same route (commit `bc2c338b`).

The macOS menu bar client is the next surface in the established cadence.
`clients/macos/Sources/KotaMenuBar/MenuBarView.swift` already mounts
`DigestView()` (line 31) and `clients/macos/Sources/KotaMenuBar/DigestView.swift`
demonstrates the pattern (loading state on the daemon-backed
`AppState.digest`, `DigestStateBadge`, `DigestExpandedContent`). There is
no equivalent `AttentionView`, no `AppState.attention` field, and no
`DaemonClient` call to `GET /api/attention`. Operators who supervise KOTA
from the menu bar therefore cannot read the current attention rollup
without falling back to a terminal, chat, or web surface, even though the
daemon is already serving the body.

The just-completed web AttentionPanel task explicitly named the macOS
menu-bar surface as the next step, and the daily-digest initiative
completed exactly this fan-out across seven surfaces (Telegram → CLI →
daemon HTTP → web → macOS → mobile → push); the macOS view is the next
step in the established cadence.

## Desired Outcome

The macOS menu bar gains an AttentionView — a collapsible row mounted in
`MenuBarView` next to `DigestView` — that calls `GET /api/attention`
through the existing `DaemonClient`, exposes the result on `AppState`
under an `attention` field, and renders the same on-demand attention body
(`text` plus `data.items`) the other four surfaces emit, including the
"nothing to attend to" reply (`NO_ATTENTION_ITEMS_TEXT`) the seam returns
when no items qualify. The view follows DigestView's load-on-expand
discipline (no fetch until the operator opens the section), surfaces an
error state when the daemon call fails, and is covered by `ModelsTests`
decoder tests on the response shape and `DaemonClientTests` URL/body
assertions on the new client method.

## Constraints

- Build on the existing `DaemonClient`, `AppState`, and `MenuBarView`
  surfaces; do not add a parallel HTTP stack or state container.
- Reuse the same daemon HTTP route the web/CLI/Telegram surfaces already
  consume. Do not introduce a second attention seam, model, or text
  formatter on the macOS side.
- Match DigestView's interaction discipline: load on expand, idempotent
  refresh, explicit loading/error/quiet/active states. Do not eagerly
  fetch on app launch.
- Keep the AttentionView visually consistent with DigestView (same
  divider/header/body composition) so the two pull-surfaces feel like one
  family.
- No silent fallback to the digest body if the attention route fails —
  surface the failure honestly.
- Respect the existing strict-by-default Swift decoding discipline used
  by `Models.swift`; do not weaken types to absorb missing fields.

## Done When

- `clients/macos/Sources/KotaMenuBar/AttentionView.swift` (or equivalent
  named file) renders an AttentionView, mounted from `MenuBarView`, that
  calls `GET /api/attention` through `DaemonClient` on first expansion
  and on operator refresh.
- `AppState` exposes an `attention` payload, an `attentionError`, and an
  `isLoadingAttention` flag matching the `digest`/`digestError`/
  `isLoadingDigest` shape, with a `loadAttention()` method.
- `Models.swift` defines a typed `AttentionResponse` (matching the daemon
  HTTP envelope `{ data: { items: AttentionItem[] }, text: string }`)
  and `ModelsTests.testAttentionResponseDecodes()` covers it.
- `DaemonClientTests` covers the `getAttention()` URL, headers, and
  response decoding.
- The body shown to the operator matches the one the web `AttentionPanel`
  shows for the same daemon state, including the empty-state copy.
- `swift build` and `swift test` both pass cleanly under the macOS client
  package.

## Source / Intent

The just-completed web AttentionPanel task (`task-add-web-client-attention-panel-consuming-apiattent`,
commit `bc2c338b`) explicitly named "macOS and mobile attention surfaces"
as the next steps. The daily-digest initiative landed the same seven-
surface cadence (Telegram → CLI → daemon HTTP → web → macOS → mobile →
push) and is the worked precedent. Operators currently driving KOTA from
the menu bar cannot see the same attention rollup other surfaces show.

## Initiative

Attention seam fan-out — match the digest seam's seven-surface client
coverage so the on-demand attention rollup the daemon already serves is
reachable from every operator surface, not just the chat and terminal
ones.

## Acceptance Evidence

- `swift build` and `swift test` output under
  `clients/macos/` showing the new AttentionView model and client tests
  passing.
- A screenshot or transcript of the macOS menu bar with AttentionView
  expanded showing both a populated-items state and the empty-state copy
  driven by the same daemon route.
- A short rendered-output sample (text body) from the AttentionView next
  to the equivalent `kota attention` CLI output proving body parity.
