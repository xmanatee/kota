---
id: task-move-post-apieventsname-inbound-webhook-event-trig
title: Move POST /api/events/:name inbound webhook event-trigger route out of core into the webhook module
status: ready
priority: p2
area: modules
summary: Extract the generic inbound HTTP→bus event-trigger route from core/server into the webhook module (or a sibling), continuing the core-shrinking initiative.
created_at: 2026-04-25T10:41:59.792Z
updated_at: 2026-04-25T10:41:59.792Z
---

## Problem

`src/core/server/server-routes.ts` still hosts `POST /api/events/:name`
(`handleEventTrigger` in `src/core/server/event-routes.ts`), the generic
inbound HTTP→bus event-trigger route used by external services (CI, GitHub
webhooks, ad-hoc curl) to fire a typed bus event by name. It is the only
remaining built-in `/api/*` route that is not part of session lifecycle,
the daemon-proxy, or `/api/health` — every other peer route has already
moved out: `/commands`, `/push-tokens`, `/owner-questions`, `/approvals`,
`/history`, `/api/schedules`, `/api/notifications`, `/metrics`, and the
static web UI.

The architecture boundary in `src/AGENTS.md` says capability-specific
inbound HTTP routes belong in the owning module, contributed through
`KotaModule.routes`. The generic event-trigger surface is a module-y
capability — distinct from `webhook-channel` (creates/resumes agent
sessions) and from daemon-control's signed `/webhooks/<workflow>`
(per-workflow HMAC trigger). It does not need core hosting.

## Desired Outcome

`POST /api/events/:name` lives in a module's `routes` contribution and
core/server no longer references `event-routes.ts` or `EventBus.emit` for
HTTP route handling. The route is reachable, behaviorally identical, and
the existing integration test (`src/webhook.integration.test.ts`) plus
e2e test (`src/server-e2e.integration.test.ts → "POST /api/events/:name —
webhook triggers"`) pass without behavior changes. Core's `/api/*` route
inventory is left with only session lifecycle (`/api/sessions`,
`/api/chat`), daemon proxy (`/api/daemon/*`), and `/api/health`.

## Constraints

- Use the existing `KotaModule.routes` / `RouteRegistration` seam — the
  same path the recent `/api/schedules`, `/api/notifications`, static-UI,
  and `/metrics` extractions used. No parallel HTTP-route registry.
- Pick one home and commit. Either extend the existing `webhook` module
  to own the generic inbound event-trigger surface (its `AGENTS.md`
  currently says it does not own inbound, so update the doc and the
  module purpose), or scaffold a tightly-scoped sibling module
  (e.g. `inbound-webhook`) that owns this route only. Do not split
  ownership between two modules.
- Preserve auth behavior: the route must continue to require the bearer
  token unless `noAuth` is set. The route's existing rate-limit-free,
  bearer-token-protected character should not regress.
- Keep `/api/health`, `/api/sessions`, `/api/chat`, and `/api/daemon/*`
  in core/server. Those are session-core or daemon-proxy and are not in
  scope.
- No backwards-compatibility shim. Delete `src/core/server/event-routes.ts`
  and the matching wiring in `server-routes.ts` once the module owns the
  route — the only acceptable end state is one home.
- Update `src/core/server/server.ts`'s startup banner so the printed
  route list matches the post-extraction reality.
- Do not introduce a new event-bus injection seam from outside core.
  The module's route handler should reach the bus through the standard
  module context (`ctx.events.emit`) rather than importing
  `#core/events/event-bus.js` directly.

## Done When

- `POST /api/events/:name` no longer appears in `src/core/server/`.
  `src/core/server/event-routes.ts` is deleted (or its remaining
  contents are unrelated and the file is renamed).
- The owning module's `AGENTS.md` documents the inbound generic
  event-trigger surface at the conventions level (purpose, auth model,
  payload shape) — not as a route catalog.
- `src/webhook.integration.test.ts` and the
  `POST /api/events/:name — webhook triggers` block in
  `src/server-e2e.integration.test.ts` pass without modification of the
  asserted behavior. Any test fixture that wires the route now exercises
  it through the module's contribution path.
- `pnpm test` and `pnpm typecheck` pass.
- The startup banner in `core/server/server.ts` no longer advertises a
  route core does not own.

## Source / Intent

Continuation of the `core-shrinking` queue cadence: every prior pass —
`/commands`, `/push-tokens`, `/owner-questions`, `/approvals`,
`/history`, `/api/schedules`, `/api/notifications`, static web UI,
Prometheus `/metrics` — moved a module-y HTTP capability out of core
into the owning module via the `KotaModule.routes` /
`KotaModule.controlRoutes` seams. `POST /api/events/:name` is the next
clean candidate and the only remaining built-in `/api/*` route that is
not session-core or daemon-proxy. Architecture goal in
`src/AGENTS.md` and `AGENTS.md`: the core stays small; capability-
specific routes belong in modules.

## Initiative

Module-first core: every capability-specific HTTP surface is contributed
by a module so `src/core/` stays focused on the agent/session loop,
daemon control, workflow runtime, and shared protocols.

## Acceptance Evidence

- A diff that deletes `src/core/server/event-routes.ts`, removes the
  matching dispatch from `src/core/server/server-routes.ts`, and adds
  the route via the owning module's `routes` contribution.
- `pnpm test src/webhook.integration.test.ts src/server-e2e.integration.test.ts`
  passes against the new wiring.
- `pnpm typecheck && pnpm test` green in the run artifact.
- Updated module `AGENTS.md` describing inbound event-trigger ownership
  at the conventions level, paired with a sentence in
  `src/core/server/AGENTS.md` (or removal of any stale claim) reflecting
  the narrower core surface.
