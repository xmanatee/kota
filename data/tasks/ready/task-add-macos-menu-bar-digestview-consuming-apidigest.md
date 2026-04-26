---
id: task-add-macos-menu-bar-digestview-consuming-apidigest
title: Add macOS menu bar DigestView consuming /api/digest
status: ready
priority: p2
area: client
summary: Add a Digest view in the macOS menu bar client that calls GET /api/digest and renders the same on-demand digest body the web DigestPanel, Telegram /digest, kota digest CLI, and daemon HTTP route already share, completing native operator-pull parity for the daily-digest seam.
created_at: 2026-04-26T05:05:25.319Z
updated_at: 2026-04-26T05:05:25.319Z
---

## Problem

The `daily-digest` workflow's on-demand seam (`renderOnDemandDigest` in
`src/modules/autonomy/workflows/daily-digest/on-demand.ts`) now backs four
operator pull-surfaces:

- Telegram `/digest` slash command (commit `68451bf5`).
- Terminal `kota digest` command, JSON and text modes (commit `ac5ba758`).
- Daemon HTTP `GET /api/digest` returning `{ data: DailyDigestData, text:
  string }` (commit `bbe6c50c`).
- Embedded web client `DigestPanel` consuming that route (commit `7d423e76`).

The macOS menu bar client — the always-visible operator surface for daily
supervision — is the only primary native operator surface still uncovered.
`clients/macos/Sources/KotaMenuBar/DaemonClient.swift` exposes typed methods
for `/status`, `/approvals`, `/owner-questions`, `/tasks`, `/sessions`, voice
routes, and chat, but has no `getDigest()`; `MenuBarView.swift` has no
Digest section. Operators who supervise KOTA from the menu bar today must
fall back to a terminal, chat, or browser surface to read the 24h rollup
even though the daemon is already serving the body.

## Desired Outcome

The macOS menu bar gains a Digest surface — a `DigestView` rendered from
`MenuBarView.swift` (collapsible section or dedicated tab) — that calls
`GET /api/digest`, renders the same operator-facing rollup the other four
surfaces emit, and labels quiet windows distinctly using the response
payload's `quiet` flag. The view uses the existing `DaemonClient`/auth
path and `AppState` model that every other section uses; it does not
introduce a parallel data layer or duplicate aggregation. The same body
parity invariant that holds across Telegram / CLI / daemon HTTP / web
holds across macOS — a single on-demand seam, five pull-surfaces.

## Constraints

- Reuse the existing `DaemonClient` (`clients/macos/Sources/KotaMenuBar/
  DaemonClient.swift`) and `AppState` patterns (`AppState.swift`). Add a
  typed `fetchDigest()` method and the corresponding `Models.swift` types,
  not an ad-hoc `URLSession` call inside the view.
- Mirror the `DailyDigestData` shape exported from
  `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Decode it
  through `JSONDecoder` against typed Swift structs in `Models.swift`. Do
  not invent a parallel response type that drifts from the daemon's
  contract.
- The `quiet` boolean on the response payload labels quiet-window output
  distinctly in the UI (icon, badge, or section header). Do not branch on
  the rendered text body to infer quiet state.
- Auth model matches the rest of `/api/*`: requests carry the bearer token
  from `daemon-control.json` via the existing `DaemonConnection`. No
  per-route bypass.
- The on-demand seam invariants enforced by the route stay intact: the
  client must never assume the GET writes `.kota/daily-digest-state.json`
  or emits `workflow.daily.digest`, and the rendered body must not flow
  into any agent prompt path. The macOS client never reads `.kota/`
  files directly except through the existing `daemon-control.json`
  discovery path (`clients/macos/AGENTS.md`), and that boundary is
  preserved.
- One mechanism. A single `DigestView` consumed by `MenuBarView.swift`,
  not two duplicated render paths.
- No backwards-compatibility shim for older daemon builds that lack
  `/api/digest`. If the route 404s, surface the daemon's typed error
  one-to-one the way approvals/owner-questions views already surface
  their daemon failure modes.
- If the `DaemonClient` hits an HTTP error, the view shows the same
  offline/error state pattern other views use; it must not preserve a
  stale digest across an offline transition (`clients/macos/AGENTS.md`).

## Done When

- A `DigestView.swift` lives under `clients/macos/Sources/KotaMenuBar/`
  and is wired into `MenuBarView.swift` so operators can read the 24h
  rollup without leaving the menu bar.
- `DaemonClient.swift` has a typed `fetchDigest()` returning the
  `{ data, text }` shape and `Models.swift` declares the
  `DailyDigestData` Swift mirror plus its nested types.
- `AppState.swift` exposes the digest as observable state (load/refresh
  on demand) with the same pattern other sections use; the view renders
  the same body the daemon serves: at minimum the rendered text plus a
  quiet-window label driven by `data.quiet`.
- Tests under `clients/macos/Tests/KotaMenuBarTests/` exercise
  `DaemonClient.fetchDigest()` (active and quiet payloads) and assert
  the typed error path when the route fails, paired with the existing
  `DaemonClientTests.swift` patterns.
- `swift build` and `swift test` are green for the macOS client.
- Documentation aligned: `src/modules/autonomy/workflows/daily-digest/
  AGENTS.md`'s On-Demand Seam section names the macOS client as the
  fifth consumer (one-line update, not a duplicated catalog).
  `clients/macos/AGENTS.md` does not need to enumerate the new view —
  the generic "all state comes from the daemon API through the daemon
  client wrapper" guidance already covers it.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T05-01-57-630Z-explorer-dz0gsz/` immediately after
the web `DigestPanel` task landed (commit `7d423e76`). The web/native
clients were named together as the consumers the daemon route was built
for; web shipped, macOS and mobile remain. macOS is the always-visible
daily-supervision surface and is the natural next consumer of the
shared on-demand body. Without this task, the daemon endpoint ships but
the menu-bar operator still has to context-switch to a terminal or
browser to read the rollup.

## Initiative

Operator-pull parity for the daily digest: every primary operator
surface (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares
one on-demand digest body via `renderOnDemandDigest`, with surface-
specific delivery wired through standard module patterns rather than
per-surface duplication.

## Acceptance Evidence

- Diff covering the new `DigestView.swift`, the typed `fetchDigest()`
  on `DaemonClient`, the `DailyDigestData` mirror in `Models.swift`,
  the `AppState` observable, the wiring into `MenuBarView.swift`, and
  the `DaemonClientTests.swift` cases.
- Screenshot under `.kota/runs/<run-id>/` of the menu bar rendering an
  active digest fixture and a quiet-window fixture, paired alongside
  the corresponding `kota digest` text and web `DigestPanel` rendering
  from the same project state to demonstrate body parity across
  surfaces.
- Test output showing the new `DaemonClientTests` cases passing.
