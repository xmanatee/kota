---
id: task-move-signature-validated-webhooksworkflowname-rout
title: Move signature-validated /webhooks/:workflowName route out of core into the webhook module
status: ready
priority: p2
area: modules
summary: Extract the signature-validated workflow-trigger route plus its HMAC/timestamp/rate-limit handler from core/daemon into the webhook module, completing the move of webhook surfaces out of core.
created_at: 2026-04-25T11:17:41.387Z
updated_at: 2026-04-25T11:17:41.387Z
---

## Problem

`POST /webhooks/:workflowName` is the signature-validated workflow-trigger
surface external systems use to fire a specific KOTA workflow with a JSON
payload. It is still hosted directly inside `src/core/daemon/`:

- `src/core/daemon/daemon-control.ts` matches the `/webhooks/` path before
  the bearer-auth middleware and dispatches to `handleWebhookRequest`.
- `src/core/daemon/daemon-control-webhook.ts` parses the body, headers, and
  signature and calls `handle.triggerWebhookRun(...)`.
- `src/core/daemon/daemon-handle.ts` (`triggerWebhookRun`) reads
  `config.webhooks.<name>.secret`, runs HMAC + timestamp validation, applies
  the per-workflow rate limit, and enqueues the run.
- The rate-limit window state (`webhookTimestamps`) lives on the daemon
  handle.

This is the only remaining webhook surface still hosted in core. Every other
HTTP capability of comparable shape — `/api/events/:name` (generic inbound
event-trigger), `/api/webhooks/github` (GitHub-flavored signature
validator), the static web UI, `/metrics`, `/api/schedules`,
`/api/notifications`, `/commands*`, `/owner-questions*`, `/approvals*`,
`/history*`, and `/push-tokens` — has already moved into its owning module
through the `KotaModule.routes` / `KotaModule.controlRoutes` seam. The
webhook module already owns webhook secrets management (CLI + `webhooks`
config key) and the inbound bus-event trigger; the signature-validated
workflow-trigger route is a clean completion of that ownership.

The blocker keeping it in core is that `ControlRouteRegistration` does not
expose `bypassAuth`, so a contributed daemon-control route cannot opt out
of the bearer-token check the way `RouteRegistration.bypassAuth` already
allows for the user-facing server (used by `github-webhook` for
`/api/webhooks/github`).

## Desired Outcome

The signature-validated workflow-trigger route is contributed by the
webhook module and core no longer hosts webhook handler code. Concretely:

- `src/core/daemon/daemon-control-webhook.ts` is deleted.
- `daemon-control.ts` no longer special-cases `/webhooks/` ahead of the
  control router; the webhook module supplies the route through
  `controlRoutes` with a path pattern and an explicit `bypassAuth: true`
  marker (a new field on `ControlRouteRegistration`, mirroring
  `RouteRegistration.bypassAuth`).
- `triggerWebhookRun`, the HMAC verification, the timestamp anti-replay
  check, the rate-limit window, and the `enqueueWebhookRun` call live
  inside `src/modules/webhook/`. The webhook module reaches the workflow
  runtime through the existing
  `#core/workflow/workflow-dispatcher-provider.js` seam (and a matching
  workflow-definitions accessor where one is already provided to module
  routes; introduce a thin read-only seam if one is missing rather than
  importing core internals directly).
- `daemon-handle.ts` no longer carries `triggerWebhookRun` or the
  `webhookTimestamps` map.
- The webhook module's `AGENTS.md` documents the signature-validated
  workflow-trigger surface at the conventions level (purpose, auth model,
  payload shape, rate-limit contract). `src/core/daemon/AGENTS.md` no
  longer lists `daemon-control-webhook.ts` as an internal subdomain.

Behavior is identical: same path, same headers, same status codes for
`200`/`401`/`404`/`409`/`429`, same `Retry-After` header on rate-limited
responses, same five-minute timestamp window, same `sha256=`-prefix
tolerance.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam — the same path the
  recent `/history`, `/approvals`, `/owner-questions`, `/push-tokens`,
  `/commands`, and `/metrics` extractions used. Do not introduce a
  parallel daemon-control route registry.
- Add `bypassAuth?: boolean` to `ControlRouteRegistration` and apply the
  bypass before the bearer-auth check in
  `DaemonControlServer.handleRequest`. Document the field next to the
  existing one on `RouteRegistration` so the two stay aligned.
- Path-parameter dispatch: the route is `POST /webhooks/:name`. The
  daemon-control router already supports `:name` segments in built-in
  routes; reuse that mechanism for contributed routes (or extend it
  symmetrically). Do not introduce a regex-only path-pattern field on
  `ControlRouteRegistration` — keep the contract aligned with how built-in
  routes are declared.
- Preserve the exact signature-verification semantics: `sha256=<hex>` or
  bare hex, `timingSafeEqual` against `createHmac("sha256",
  secret).update(rawBody).digest("hex")`, ±5 minute window when
  `X-Kota-Webhook-Timestamp` is present, response codes unchanged.
- Preserve the exact rate-limit contract: per-workflow,
  `definition.webhookRateLimit.maxPerMinute`, sliding 60s window,
  `Retry-After` set to `Math.ceil(retryAfterMs / 1000)`. Move the window
  state into the webhook module — daemon state should not carry it.
- Do not introduce a new event-bus or scheduler injection seam beyond
  what the existing module-context provider seams (`workflow-dispatcher`,
  workflow-metrics) already give modules. If a workflow-definitions
  accessor is missing, add a small read-only provider alongside the
  existing seams; do not import `#core/workflow/...` internals from a
  module.
- No backwards-compatibility shim. Delete `daemon-control-webhook.ts`
  and the `triggerWebhookRun`/`webhookTimestamps` members on
  `daemon-handle.ts`. The only acceptable end state is one home in the
  webhook module.
- Keep the `src/distributable-surfaces.test.ts` invariants
  (`/webhooks/...` shape and `X-Kota-Webhook-Signature` /
  `X-Kota-Webhook-Timestamp` headers) green. The current test reads
  `src/core/daemon/daemon-control-webhook.ts` directly and must be
  retargeted to wherever the handler lives next without changing the
  asserted behavior.
- Add or repoint a no-core guard test (in the `no-daemon-control-*.test.ts`
  family that already lives under `src/core/daemon/`) asserting core no
  longer imports the webhook handler.

## Done When

- `src/core/daemon/daemon-control-webhook.ts` is gone and
  `daemon-control.ts` contains no `/webhooks/` special case.
- `triggerWebhookRun` and the rate-limit window are owned by
  `src/modules/webhook/`; `daemon-handle.ts` no longer mentions them.
- `ControlRouteRegistration` exposes `bypassAuth?: boolean` and the
  daemon-control router honors it before the bearer-auth check.
- Existing webhook tests pass without behavior changes:
  `src/core/daemon/daemon-control.test.ts` (signature/timestamp/
  rate-limit/missing-secret blocks), `src/distributable-surfaces.test.ts`
  (webhook path + signature header invariants), and any
  `src/modules/webhook/*.test.ts` exercises retargeted to the new wiring.
- A `no-daemon-control-webhook.test.ts` guard joins the existing no-core
  guard family, mirroring `no-daemon-control-history.test.ts`.
- The webhook module's `AGENTS.md` describes the signature-validated
  trigger surface alongside its existing inbound/outbound responsibilities;
  `src/core/daemon/AGENTS.md` drops `daemon-control-webhook.ts` from its
  internal-subdomain list.
- `pnpm test` and `pnpm typecheck` pass.

## Source / Intent

Continuation of the core-shrinking initiative. The most recent ten
commits at queue-empty time (`f63132ca`, `030d40d7`, `9ca429d4`,
`6d2bcf68`, `f37d7f80`, `47914cf7`, `1d2728ea`, `6011d701`, `d8655ed0`)
are all module-extraction passes that follow this exact shape: identify
a capability-specific HTTP surface still hosted in core, move the
handler into its owning module via `KotaModule.routes` /
`KotaModule.controlRoutes`, delete the core path, add a no-core guard
test, and update the relevant `AGENTS.md`. The webhook trigger route is
the next clean candidate and the only remaining webhook surface in
core. Architecture goal in `src/AGENTS.md` and `AGENTS.md`: keep core
small and protocol-oriented; capability-specific routes belong in the
owning module.

## Initiative

Module-first core: every capability-specific HTTP surface — including
the daemon-control plane, not just the user-facing server — is
contributed by the owning module so `src/core/` stays focused on the
agent/session loop, daemon control protocol, workflow runtime, and
shared protocols.

## Acceptance Evidence

- A diff that deletes `src/core/daemon/daemon-control-webhook.ts`,
  removes `triggerWebhookRun` and `webhookTimestamps` from
  `daemon-handle.ts`, removes the `/webhooks/` block from
  `daemon-control.handleRequest`, adds `bypassAuth` to
  `ControlRouteRegistration`, and adds the contributed route plus
  helpers under `src/modules/webhook/`.
- `pnpm test src/core/daemon/daemon-control.test.ts
  src/distributable-surfaces.test.ts src/modules/webhook` green against
  the new wiring (the daemon-control test continues to assert the same
  status codes; the distributable-surfaces test points at the new
  handler file).
- A new `src/core/daemon/no-daemon-control-webhook.test.ts` mirroring
  the existing no-core guard family.
- Updated `src/modules/webhook/AGENTS.md` documenting the signature-
  validated trigger surface (purpose, auth model, payload shape,
  rate-limit contract) at the conventions level, paired with the removal
  of `daemon-control-webhook.ts` from `src/core/daemon/AGENTS.md`'s
  internal-subdomain list.
- `pnpm typecheck && pnpm test` green in the run artifact.
