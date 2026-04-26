---
id: task-add-daemon-http-digest-endpoint-consuming-the-on-d
title: Add daemon HTTP digest endpoint consuming the on-demand digest seam
status: done
priority: p2
area: modules
summary: Expose 'GET /api/digest' on the daemon control server returning the same on-demand digest body the Telegram /digest command and 'kota digest' CLI already emit, so web and future native clients can pull the same rollup without depending on the terminal.
created_at: 2026-04-26T03:57:24.799Z
updated_at: 2026-04-26T04:06:51.653Z
---

## Problem

The `daily-digest` workflow ships an on-demand seam
(`renderOnDemandDigest` in
`src/modules/autonomy/workflows/daily-digest/on-demand.ts`) and now has
two operator surfaces: the Telegram `/digest` command (commit
`68451bf5`) and the terminal `kota digest` command (commit `ac5ba758`).
Both call `renderOnDemandDigest` directly, so the rendered body cannot
drift between channels.

The third primary operator surface — daemon-backed web/native clients
served through `kota serve` and the daemon control API — is uncovered.
`src/core/server/server-routes.ts` exposes `/api/health`,
`/api/sessions`, `/api/chat`, `/api/daemon/events`, and
`/api/daemon/status` but no `/api/digest`. Operators who supervise
KOTA from a browser or native client cannot pull the same 24h rollup
without shelling out to a terminal. The just-completed
`task-add-kota-digest-cli-command-consuming-the-on-deman` named the
web/native client as the next surface in the operator-pull parity
initiative.

## Desired Outcome

`GET /api/digest` on the daemon control server returns the structured
`DailyDigestData` payload plus the rendered text body the Telegram
`/digest` command and `kota digest` already produce. The endpoint is
contributed by the autonomy module through the standard
`KotaModule.routes` factory (or alongside the existing daily-digest
workflow's `commands` factory), not via a direct edit to
`src/core/server/server-routes.ts`. The on-demand invariants stay
intact: no `.kota/daily-digest-state.json` write, no
`workflow.daily.digest` emission, no `exposeOutputToAgent` exposure of
the body in any agent prompt path.

## Constraints

- Reuse `renderOnDemandDigest` directly. Do not duplicate the
  aggregation or rendering pipeline.
- The route is contributed by the owning module via the standard
  `KotaModule.routes` (or equivalent) factory. Do not add a parallel
  HTTP route registry, and do not edit
  `src/core/server/server-routes.ts` to wire a per-feature endpoint.
- The endpoint returns one canonical response shape:
  `{ data: DailyDigestData, text: string }`. No content-type branching
  on `Accept` (chat surfaces consume `text`; programmatic surfaces
  consume `data`). The response carries the on-demand seam's `quiet`
  flag so clients can label quiet windows distinctly without
  re-rendering.
- Honor the on-demand seam invariants: no
  `.kota/daily-digest-state.json` write, no `workflow.daily.digest`
  emission, no `exposeOutputToAgent` path. The HTTP body is
  operator-facing only and must not leak into autonomy agent prompts
  (no-cost-bias-in-autonomy memory).
- Auth model matches the rest of `/api/*`: the existing
  `ServerContext.authToken` bearer-token / query-token check must
  guard the route. Do not add a per-route bypass.
- No backwards-compatibility hooks. The endpoint is the canonical
  web-side surface; if a future client wants a different time window,
  expose `windowEndMs` as an optional query parameter that maps to
  `renderOnDemandDigest`'s parameter, not via a second endpoint.

## Done When

- `GET /api/digest` returns `{ data: DailyDigestData, text: string }`
  matching `renderOnDemandDigest` output for the daemon's project
  directory.
- The route is contributed through a `KotaModule.routes` factory in
  the autonomy module (or daily-digest workflow directory), not via
  direct registration in `src/core/server/`.
- A focused integration-style test exercises the endpoint against a
  fixture project directory, asserting (a) text-body equivalence with
  `renderOnDemandDigest`, (b) the structured payload shape, (c) no
  `.kota/daily-digest-state.json` write, (d) no `workflow.daily.digest`
  emission, and (e) auth-token enforcement.
- The endpoint is documented at the narrowest applicable `AGENTS.md`
  (`src/modules/autonomy/workflows/daily-digest/AGENTS.md` on-demand
  seam section gains a one-line note that `/api/digest` is the
  web/native consumer).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T03-55-31-827Z-explorer-v5al2a/` after the
`Add kota digest CLI command consuming the on-demand digest seam`
commit (`ac5ba758`) landed the terminal operator surface. The
just-completed task explicitly named the web/native operator surface
as the next step in the operator-pull parity initiative; the
on-demand seam was specifically designed so any pull-surface renders
the same body without drift, and `kota serve` plus the daemon control
API are the remaining pull surface that is uncovered.

## Initiative

Operator-pull parity for the daily digest: every primary operator
surface (Telegram, terminal, web/native clients) shares one on-demand
digest body via `renderOnDemandDigest`, with surface-specific delivery
wired through standard module patterns rather than per-surface
duplication.

## Acceptance Evidence

- Diff covering the new `/api/digest` route, its contribution from a
  module's `routes` factory, and the focused test that asserts
  text-body equivalence with `renderOnDemandDigest` plus the no-write
  / no-emit / auth invariants.
- `curl` transcript captured against a representative project
  directory under `.kota/runs/<run-id>/` showing the endpoint's text
  and JSON body (with the daemon's bearer token applied) paired
  alongside the corresponding `kota digest` and Telegram `/digest`
  outputs from the same project state to demonstrate body parity.
