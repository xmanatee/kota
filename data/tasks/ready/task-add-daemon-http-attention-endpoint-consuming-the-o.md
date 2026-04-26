---
id: task-add-daemon-http-attention-endpoint-consuming-the-o
title: Add daemon HTTP attention endpoint consuming the on-demand attention seam
status: ready
priority: p2
area: modules
summary: Expose 'GET /api/attention' on the daemon control server returning the same on-demand attention body the Telegram /attention command and 'kota attention' CLI already emit, so web and future native clients can pull the same attention rollup without depending on the terminal.
created_at: 2026-04-26T07:55:33.040Z
updated_at: 2026-04-26T07:55:33.040Z
---

## Problem

The `attention-digest` workflow ships an on-demand seam
(`renderOnDemandAttention` in
`src/modules/autonomy/workflows/attention-digest/step.ts`) and now has
two operator surfaces: the Telegram `/attention` command (commit
`3090d2c6`) and the terminal `kota attention` command (commit
`50e12ddf`). Both call `renderOnDemandAttention` directly, so the
rendered body cannot drift between channels.

The third primary operator surface — daemon-backed web/native clients
served through `kota serve` and the daemon control API — is uncovered.
The autonomy module already contributes `GET /api/digest` via
`digestRoutes(...)` in `src/modules/autonomy/index.ts`, but no
`/api/attention` counterpart exists. Operators who supervise KOTA from
a browser or native client cannot pull the current attention items
without shelling out to a terminal. The `daily-digest` initiative
completed exactly this fan-out, in this same order, across seven
surfaces (Telegram → CLI → daemon HTTP → web → macOS → mobile → push);
the just-completed `task-add-kota-attention-cli-command-consuming-the-on-de`
explicitly named `/api/attention` as the next surface in the
attention-digest fan-out.

## Desired Outcome

`GET /api/attention` on the daemon control server returns the
structured `AttentionItem[]` payload plus the rendered text body the
Telegram `/attention` command and `kota attention` already produce.
The endpoint is contributed by the autonomy module through the
existing `KotaModule.routes` factory (alongside `digestRoutes`), not
via a direct edit to `src/core/server/server-routes.ts`. The
on-demand invariants stay intact: no
`<runsDir>/../attention-digest-counter.json` write, no
`workflow.attention.digest` emission, no `exposeOutputToAgent`
exposure of the body in any agent prompt path.

## Constraints

- Reuse `renderOnDemandAttention` directly. Do not duplicate the
  detector or rendering pipeline.
- The route is contributed by the owning module via the existing
  `KotaModule.routes` factory in `src/modules/autonomy/index.ts`. Add
  an `attentionRoutes(...)` factory next to `digestRoutes(...)` and
  spread both into the module's `routes:` return value. Do not add a
  parallel HTTP route registry, and do not edit
  `src/core/server/server-routes.ts` to wire a per-feature endpoint.
- The endpoint returns one canonical response shape:
  `{ data: { items: AttentionItem[] }, text: string }`. No
  content-type branching on `Accept` (chat surfaces consume `text`;
  programmatic surfaces consume `data.items`).
- Honor the on-demand seam invariants from
  `src/modules/autonomy/workflows/attention-digest/AGENTS.md`: no
  `<runsDir>/../attention-digest-counter.json` write, no
  `workflow.attention.digest` emission, no `exposeOutputToAgent`
  path. The HTTP body is operator-facing only and must not leak into
  autonomy agent prompts (no-cost-bias-in-autonomy memory).
- Auth model matches the rest of `/api/*`: the existing
  `ServerContext.authToken` bearer-token / query-token check must
  guard the route. Do not add a per-route bypass.
- No backwards-compatibility hooks. The endpoint is the canonical
  web-side surface; if a future client wants a different cursor or
  filter, expose it as an optional query parameter that maps to a
  parameter on `renderOnDemandAttention`, not via a second endpoint.

## Done When

- `src/modules/autonomy/workflows/attention-digest/attention-route.ts`
  exposes `attentionRoutes(opts: { projectDir: string }): RouteRegistration[]`
  returning a single `GET /api/attention` handler that calls
  `renderOnDemandAttention({ projectDir, runsDir })` and emits
  `{ data: { items: AttentionItem[] }, text: string }`.
- `src/modules/autonomy/index.ts` imports `attentionRoutes` and
  spreads it into the existing `routes:` factory next to
  `digestRoutes(...)`.
- A focused test
  (`src/modules/autonomy/workflows/attention-digest/attention-route.test.ts`)
  exercises the endpoint against a fixture project directory and
  asserts (a) text-body equivalence with `renderOnDemandAttention`,
  (b) the structured payload shape, (c) no
  `<runsDir>/../attention-digest-counter.json` write,
  (d) no `workflow.attention.digest` emission, and (e) auth-token
  enforcement.
- `src/modules/autonomy/workflows/attention-digest/AGENTS.md` gains a
  one-line note on its on-demand seam section that `/api/attention`
  is the web/native consumer (matching the daily-digest precedent).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer at
`.kota/runs/2026-04-26T07-54-04-957Z-explorer-vgy74f/` after the
just-landed `kota attention` CLI (`50e12ddf`) closed the second
surface in the attention-digest fan-out. The attention CLI task's
Source / Intent paragraph names the next surfaces verbatim — `/api/attention`,
web/macOS/mobile attention panels — to follow once the seam is in
place. The `daily-digest` initiative completed exactly this fan-out
in this same order across seven surfaces (Telegram → CLI → daemon
HTTP → web → macOS → mobile → push); the daemon HTTP surface is the
next step in the established cadence.

## Initiative

Operator observability for autonomous KOTA operation: every
operator-facing surface should answer "what currently warrants
attention" without the operator scraping `.kota/runs/`,
`data/tasks/<state>/`, or in-process owner-question state by hand.
`/api/attention` is the daemon HTTP pull surface mirroring the
just-landed `kota attention` CLI, continuing the attention-digest
fan-out toward parity with the daily-digest pull pattern.

## Acceptance Evidence

- A live-run transcript under `.kota/runs/<run-id>/` showing
  `curl http://localhost:<port>/api/attention?token=<token>` returning
  `{ data: { items: [...] }, text: "..." }` against a real or
  fixture-seeded repo state, side-by-side with the seam's
  `renderOnDemandAttention(...).text` to prove parity.
- Co-located test
  `src/modules/autonomy/workflows/attention-digest/attention-route.test.ts`
  exercising parity, payload shape, no-counter-write, no-bus-event,
  and auth-token invariants and passing on `pnpm test`.
- Confirmation that
  `<runsDir>/../attention-digest-counter.json` is unchanged after a
  request (recorded in the run artifact, mirroring the digest
  endpoint's evidence pattern).
