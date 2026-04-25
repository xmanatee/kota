---
id: task-migrate-push-tokens-daemon-control-route-out-of-co
title: Migrate /push-tokens daemon-control route out of core into a push-notification module
status: done
priority: p2
area: architecture
summary: Move the /push-tokens registration route, the .kota/push-tokens.json store, the Expo Push API delivery, and the approval.requested bus subscription from src/core/daemon/ into a new push-notification module via KotaModule.controlRoutes, mirroring the owner-questions/approvals/history/voice migration pattern, and add an import-guard test refusing reintroduction.
created_at: 2026-04-25T07:04:33.275Z
updated_at: 2026-04-25T07:15:15.810Z
---

## Problem

`src/core/daemon/daemon-control.ts` still hard-codes the
`POST /push-tokens` control-plane route and dispatches it through
`src/core/daemon/daemon-control-push-tokens.ts`. The store
(`src/core/daemon/push-tokens.ts` — load/save plus the Expo Push API
fire-and-forget `sendPushNotifications`) and the
`bus.on("approval.requested", …)` subscription that drives delivery both
live in core (`daemon-handle.ts` lines 47–58 wire the subscription;
`registerPushToken` is exposed as a `DaemonControlHandle` method to the
route handler). No `push-notification` module owns this surface today;
the entire Expo-push concern — store file, send transport, registration
route, and bus glue — is core-resident even though it is a self-contained
notification-channel capability with no shared-runtime role.

The `controlRoutes` seam landed with the voice migration (`aa59e6f8`)
and was applied to history (`d8655ed0`), approvals (`6011d701`), and
owner-questions (`1d2728ea`). `src/core/daemon/AGENTS.md` now names the
seam as the recommended pattern for module-owned control-plane
endpoints. Push-tokens is the next clearest application — and the
first one in the migration sequence that requires creating the owning
module rather than reusing an existing one — because nothing about the
Expo Push API delivery, push-token persistence, or approval-driven push
fan-out is a shared runtime primitive: it is one external transport
choice (Expo) bound to one event (`approval.requested`) with one
operator-facing registration route.

## Desired Outcome

A new `src/modules/push-notification/` module owns the entire Expo-push
surface: the push-token store (read/write `.kota/push-tokens.json`), the
`sendPushNotifications` Expo Push API call, the
`approval.requested` bus subscription that drives delivery, and the
`POST /push-tokens` daemon-control route contributed through
`KotaModule.controlRoutes`. The module subscribes to the bus through
`ctx.events.subscribe("approval.requested", …)` in `onLoad` and
unsubscribes in `onUnload`, exactly the way `slack-channel`, `telegram`,
and `email` already drive their own approval delivery.
`src/core/daemon/daemon-control-push-tokens.ts` and
`src/core/daemon/push-tokens.ts` are deleted along with their route-scope
and dispatch entries in `daemon-control.ts`. The `registerPushToken`
method is removed from `DaemonControlHandle` and `daemon-handle.ts`, the
`approval.requested` subscription block is removed from
`buildDaemonHandle`, and the corresponding `Push-token store` line under
the daemon `AGENTS.md` Recoverability list moves to the module's own
`AGENTS.md`. The wire contract — bearer-token check, `control` scope on
`POST /push-tokens`, JSON request body
`{ token: string, deviceId: string }`, `400 { error: "Invalid JSON
body" }` on parse failure, `400 { error: "token and deviceId are
required" }` on missing fields, `200 { ok: true }` on success — is
preserved and covered by a co-located `DaemonControlServer`-based test
in the new module, mirroring the approval-queue, voice, history, and
owner-questions modules' pattern. A new import-guard test refuses any
future reintroduction of `daemon-control-push-tokens*.ts` or
`push-tokens.ts` under `src/core/daemon/`. Route-key collisions with
built-ins or with another module's contribution still throw at server
construction.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam. Do not introduce a
  parallel registration path or a shadow router.
- Preserve the existing route path (`POST /push-tokens`), capability
  scope (`control` — match the current `BUILTIN_ROUTE_SCOPES` table in
  `daemon-control.ts`), bearer-token gating, status codes, and response
  shapes (`{ token, deviceId }` body validation, `400` on missing
  fields, `200 { ok: true }` on success).
- The Expo Push API delivery must stay fire-and-forget on
  `approval.requested`. Do not introduce a retry loop, a queue, or
  blocking error propagation; SSE remains the reliable real-time path
  for clients with the app open. Logging on Expo HTTP failure stays
  best-effort through `ctx.log.warn(...)`.
- The push-token store stays under `<projectDir>/.kota/push-tokens.json`
  with the same `{ tokens: { [deviceId]: { token, deviceId,
  registeredAt } } }` shape. Do not change the file layout. The module
  reads `<projectDir>` from `ctx.projectDir` (or the equivalent module
  context property — pick the one already used by approval-queue,
  history, owner-questions for parity).
- The `approval.requested` payload-to-push mapping (title
  `"<source> — <tool>"` falling back to `"Approval: <tool>"`, body
  `"Risk: <risk>"`, deep-link `data.screen = "approvals"` carrying
  `data.approvalId`) is preserved verbatim. The mobile-client deep-link
  contract must continue to work; no change to the message shape.
- Core must not import from `#modules/push-notification/*`. The
  repo-wide guard in
  `src/core/agent-harness/no-module-imports-in-core.test.ts` already
  enforces this; do not weaken it. Add a dedicated import-guard test
  under `src/core/daemon/` (e.g.
  `no-daemon-control-push-tokens.test.ts`) that refuses any new
  `daemon-control-push-tokens*.ts` or `push-tokens.ts` under
  `src/core/daemon/`, matching the approvals/history/owner-questions
  precedents (`no-daemon-control-approvals.test.ts`,
  `no-daemon-control-history.test.ts`,
  `no-daemon-control-owner-questions.test.ts`).
- Remove `DaemonControlHandle.registerPushToken` and the corresponding
  `daemon-handle.ts` implementation once nothing in core still needs it.
  Remove the `approval.requested` bus subscription block from
  `buildDaemonHandle` in the same change.
- Existing daemon-control client wrappers (e.g.
  `DaemonControlClient.registerPushToken`, the mobile-client startup
  call) and any callers in CLI/web/native/mobile paths must continue to
  work unchanged. Adjust internal wiring if needed, but do not change
  the wire contract.
- Update `src/core/daemon/AGENTS.md` and add
  `src/modules/push-notification/AGENTS.md` so each describes the new
  seam location truthfully. Remove `daemon-control-push-tokens.ts` from
  the "internal subdomains" enumeration and `push-tokens.ts` from the
  "daemon primitives" line in the daemon `AGENTS.md`. Move the
  `Push-token store` recoverability bullet to the new module's
  `AGENTS.md` (note `.kota/push-tokens.json` is rewritten on every
  registration).
- Decide deliberately whether the new module declares a dependency on
  `notification` (which owns shared `postWithRetry` HTTP retry helpers).
  Either reuse `postWithRetry` if it fits, or document why Expo's
  fire-and-forget contract sits below the retry primitive; do not
  silently bypass an existing shared mechanism.
- Add the new module to the default `KotaConfig` module list (or
  whichever loader path activates voice/approval-queue/history/owner-
  questions today) so the daemon picks it up out of the box. Do not
  ship a regression where the route is silently absent because the
  module isn't loaded.

## Done When

- `src/core/daemon/daemon-control-push-tokens.ts` and
  `src/core/daemon/push-tokens.ts` are deleted.
- `src/core/daemon/daemon-control.ts` no longer references the
  `/push-tokens` route, scope, or handler — the file's import list,
  the `BUILTIN_ROUTE_SCOPES` table, and the dispatch switch are clean
  of `/push-tokens` entries.
- `src/core/daemon/daemon-handle.ts` no longer imports or calls
  `registerPushToken` / `sendPushNotifications`, and no longer
  subscribes to `approval.requested` for push fan-out.
  `DaemonControlHandle.registerPushToken` is removed from
  `daemon-control-types.ts`.
- A new `src/modules/push-notification/` module exists with: an
  `index.ts` declaring the `KotaModule` (name, version, description,
  `onLoad` that subscribes to `approval.requested` and registers the
  store, `onUnload` that releases the subscription, `controlRoutes`
  contributing `POST /push-tokens` with `capabilityScope: "control"`),
  the store helpers, the Expo Push API send function, and the route
  handler (or shared helper) reused by the controlRoutes contribution.
- A co-located `DaemonControlServer`-based test exercises register
  end-to-end against the registered route including the `control`
  capability-scope check, the missing-body 400, and the missing-fields
  400, plus a unit test that verifies `approval.requested` triggers
  the Expo Push API call with the expected payload shape (use a
  `fetch` stub or Expo HTTP mock).
- An import-guard test rejects any new
  `daemon-control-push-tokens*.ts` or `push-tokens.ts` under
  `src/core/daemon/` — modeled on
  `no-daemon-control-owner-questions.test.ts`.
- The repo-wide `no-module-imports-in-core` guard still passes
  unmodified.
- `pnpm test` passes on the resulting branch with the new module-side
  tests included.
- `src/core/daemon/AGENTS.md` and the new
  `src/modules/push-notification/AGENTS.md` describe the migration's
  outcome accurately; no stale references to
  `daemon-control-push-tokens.ts`, `push-tokens.ts` (under
  `src/core/daemon/`), or the removed `DaemonControlHandle` push-token
  method remain anywhere in the repo.

## Source / Intent

The just-landed owner-questions migration
(`task-migrate-owner-questions-daemon-control-routes-out-`, commit
`1d2728ea`) closed the previous-clearest module-owned candidate and
explicitly named the remaining `daemon-control-*` files as future
migration targets, splitting them into "module-owned candidates" and
"genuinely-core ones". Push-tokens is the next clearest module-owned
candidate: the entire Expo-push concern is one external transport
bound to one bus event with one registration route — no shared runtime
role beyond the daemon's `bus` and `projectDir`, both of which
`ctx.events` and `ctx.projectDir` already expose to modules. Owner
direction throughout the architecture initiative has been "minimal
core, module-first" — voice (`aa59e6f8`), Claude-SDK executor
(`f3a1b444`), architect mode (`85bb9176`), and the `HistoryProvider`
inversion (`8f12be9e`) all moved capability out of `src/core/`. This
task continues the sequence and completes the first migration that
also creates a new module rather than extending an existing one.

## Initiative

Minimal-core, module-first architecture: every module-owned capability
should also own its operator-facing surfaces, including HTTP control
routes. Each migration like this one shrinks the core boundary and
makes the seam discoverable as the recommended pattern for any future
module contributing control-plane endpoints. After this task lands,
the remaining `daemon-control-*` handlers in core (commands, metrics,
sessions, webhook, workflow) split into module-owned candidates
(`commands` for `/commands*`, possibly a future `metrics` module for
`/metrics`) and genuinely-core ones (`sessions*`, `webhook`,
`workflow*`) tied to runtime primitives that should remain on the
daemon control plane.

## Acceptance Evidence

- Diff showing `daemon-control-push-tokens.ts` and `push-tokens.ts`
  deleted from `src/core/daemon/`, `daemon-control.ts` cleaned of
  push-token entries, `daemon-handle.ts` cleaned of the push-token
  imports, the `registerPushToken` shim, and the `approval.requested`
  subscription block, `daemon-control-types.ts` cleaned of
  `registerPushToken`, the new
  `src/modules/push-notification/` module appearing with
  `controlRoutes` and the bus subscription, and the new import-guard
  test.
- New module-side `DaemonControlServer` test covering register
  including the `control` capability-scope check, the 400 missing-body
  path, and the 400 missing-fields path, plus a unit test asserting
  the `approval.requested → fetch(Expo Push API)` payload shape —
  pasted transcript or named test file in the run directory or PR
  body.
- `pnpm test` output (or relevant filtered subset) showing the new
  tests green and the import-guard test green.
- Updated `src/core/daemon/AGENTS.md` and new
  `src/modules/push-notification/AGENTS.md` with the new seam wording
  and the moved Recoverability bullet.
