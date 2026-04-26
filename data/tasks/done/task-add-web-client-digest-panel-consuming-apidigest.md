---
id: task-add-web-client-digest-panel-consuming-apidigest
title: Add web client digest panel consuming /api/digest
status: done
priority: p2
area: modules
summary: Add a Digest sidebar panel/view in the embedded web client that calls GET /api/digest and renders the same on-demand digest body the Telegram /digest, kota digest CLI, and daemon HTTP route already share, completing the web/native consumer of the on-demand digest seam.
created_at: 2026-04-26T04:30:37.481Z
updated_at: 2026-04-26T04:37:15.572Z
---

## Problem

The `daily-digest` workflow's on-demand seam (`renderOnDemandDigest` in
`src/modules/autonomy/workflows/daily-digest/on-demand.ts`) now backs three
of the four primary operator surfaces:

- Telegram `/digest` slash command (commit `68451bf5`).
- Terminal `kota digest` command, JSON and text modes (commit `ac5ba758`).
- Daemon HTTP `GET /api/digest` route returning
  `{ data: DailyDigestData, text: string }` (commit `bbe6c50c`).

The fourth — the embedded web client served by `kota serve` — is the only
operator pull-surface still uncovered. `clients/web/src/components/sidebar/
Sidebar.tsx` exposes panels for Overview, Sessions, History, Approvals,
Owner Questions, Tasks, Workflows, Active Sessions, Workflow Definitions,
Schedules, Analytics, Knowledge, Memory, Guardrail Audit, Modules, and
Config; there is no Digest panel and `clients/web/src/api/client.ts` /
`clients/web/src/api/queries.ts` have no `/api/digest` consumer. Operators
who supervise KOTA from the daemon-backed web UI today cannot read the
24h rollup without falling back to a terminal or chat surface, even though
the daemon is already serving the body.

## Desired Outcome

The embedded web client gains a Digest surface — a `DigestPanel` in the
sidebar (and/or a routed view) — that calls `GET /api/digest`, renders the
same operator-facing rollup the other three surfaces emit, and labels
quiet windows distinctly using the response payload's `quiet` flag. The
panel uses the existing TanStack Query stack and bearer-token auth path
that every other panel uses; it does not introduce a parallel data layer
or a duplicate aggregation pipeline. The same body parity invariant that
holds across Telegram / CLI / daemon HTTP holds across web — a single
on-demand seam, four pull-surfaces.

## Constraints

- Reuse the existing daemon API client (`clients/web/src/api/client.ts`)
  and TanStack Query patterns (`clients/web/src/api/queries.ts`). Add a
  typed `getDigest()` method and a `digestQuery` (or equivalent), not a
  bespoke `fetch` call inside the component.
- Reuse the structured `DailyDigestData` shape exported from
  `src/modules/autonomy/workflows/daily-digest/aggregate.ts` for typing
  on the client side. Do not redeclare a parallel response type. Either
  publish the type for client consumption (see `clients/web/AGENTS.md`
  on the typed client/daemon contract) or import it through the existing
  shared-types path.
- The `quiet` boolean on the response payload labels quiet-window output
  distinctly in the UI. Do not branch on the rendered text body to infer
  quiet state.
- Auth model matches the rest of `/api/*`: requests carry the existing
  bearer token via `authHeaders()`. No per-route bypass.
- The on-demand seam invariants enforced by the route stay intact: the
  client must never assume the GET writes `.kota/daily-digest-state.json`
  or emits `workflow.daily.digest`, and the rendered body must not flow
  into any agent prompt path. The web client never reads `.kota/` files
  directly (`clients/web/AGENTS.md`), and that boundary is preserved.
- One mechanism. Either a sidebar panel, a routed `/digest` view, or
  both, but the rendering of the digest body lives in one component
  consumed by every entry point. No duplicated render path.
- No backwards-compatibility shim for older daemon builds that lack
  `/api/digest`. If the route 404s, surface the daemon's typed error
  one-to-one the way voice / approvals / owner-questions panels already
  surface their daemon failure modes.

## Done When

- A `DigestPanel` component (or routed view) lives under
  `clients/web/src/components/` and is wired into `Sidebar.tsx` (or the
  router) so operators can read the 24h rollup without leaving the web
  UI.
- `clients/web/src/api/client.ts` has a typed `getDigest()` method
  returning `{ data: DailyDigestData, text: string }` and
  `clients/web/src/api/queries.ts` exposes a `digestQuery` keyed under
  `queryKeys.digest`.
- The panel renders the same body the daemon serves: at minimum the
  rendered text plus a quiet-window label driven by `data.quiet`.
- Component-level tests under `clients/web/` exercise the panel with a
  mocked `/api/digest` response (active and quiet payloads) and assert
  the panel surfaces the daemon's typed error path when the route fails.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client (`pnpm --filter <web-client>` if needed).
- Documentation aligned: `src/modules/autonomy/workflows/daily-digest/
  AGENTS.md`'s On-Demand Seam section names the web client as the fourth
  consumer (one-line update, not a duplicated catalog), and
  `clients/web/AGENTS.md` does not need to enumerate the new panel — the
  generic "consumes only the daemon HTTP+JSON API" guidance already
  covers it.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T04-28-26-860Z-explorer-3q5wjj/` immediately after
the daemon `/api/digest` route landed (commit `bbe6c50c`,
"Add daemon HTTP /api/digest route consuming the on-demand digest
seam"). The just-completed daemon-route task explicitly named the
"web/native client" as the consumer the route was built for; the
on-demand seam was specifically designed so any pull-surface renders the
same body without drift, and the embedded web client is the only
remaining primary operator surface that does not consume it. Without
this task, the daemon endpoint is shipped but unused by the operator
surface that is supposed to use it.

## Initiative

Operator-pull parity for the daily digest: every primary operator
surface (Telegram, terminal, daemon HTTP, web/native clients) shares one
on-demand digest body via `renderOnDemandDigest`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication.

## Acceptance Evidence

- Diff covering the new `DigestPanel` (and/or routed view), the typed
  `getDigest()` API method, the `digestQuery` registration, the wiring
  into `Sidebar.tsx`, and the component-level tests.
- Screenshot or rendered DOM snapshot under `.kota/runs/<run-id>/` of the
  panel against an active digest fixture and a quiet-window fixture,
  paired alongside the corresponding `kota digest` text and Telegram
  `/digest` text from the same project state to demonstrate body parity
  across surfaces.
- Test output showing the new component-level tests passing.
