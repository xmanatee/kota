---
id: task-move-prometheus-get-metrics-exposition-out-of-core
title: Move Prometheus GET /metrics exposition out of core into the tracing module
status: ready
priority: p2
area: architecture
summary: Continue the module-first core-shrinking pattern by migrating the daemon-control Prometheus /metrics handler from src/core/daemon/ into the tracing module via KotaModule.controlRoutes, so observability lives in one module.
created_at: 2026-04-25T09:22:08.356Z
updated_at: 2026-04-25T09:22:08.356Z
---

## Problem

`src/core/daemon/daemon-control-metrics.ts` (~94 LOC) renders the
Prometheus `GET /metrics` exposition for KOTA — workflow run counts,
cost totals, duration histogram, active sessions, pending approvals,
dispatch-paused gauge, active and queued runs. It lives in core and is
wired into `BUILTIN_ROUTE_SCOPES` in `src/core/daemon/daemon-control.ts`.

KOTA already has a dedicated observability module at
`src/modules/tracing/` that owns OpenTelemetry traces and the OTLP push
metrics emitter (`WorkflowMetricsEmitter`). The pull-based Prometheus
exposition is the same concern, just a different transport. Keeping it
in core spreads observability ownership across two trees and contradicts
the architecture guidance that "general-purpose capabilities should not
accumulate in the core by default" and "capability-specific routes
belong in the owning module".

This is the next item in the established core-shrinking initiative —
the last seven commits each migrated a daemon-control route family
(`/history`, `/approvals`, `/owner-questions`, `/push-tokens`,
`/commands`, `/api/schedules` + `/api/notifications`, and the static web
UI) out of core via `KotaModule.controlRoutes`. The same seam fits
`GET /metrics`.

## Desired Outcome

`GET /metrics` is contributed by the tracing module through
`KotaModule.controlRoutes` with `capabilityScope: "read"`, identical in
URL path, content type (`text/plain; version=0.0.4; charset=utf-8`),
and rendered Prometheus body to today's behavior. The handler reads its
inputs from the standard surfaces (`DaemonControlHandle` for workflow
metric counts / sessions / live status, `getApprovalQueue()` for
pending-approval count). `src/core/daemon/daemon-control-metrics.ts`,
its entry in `BUILTIN_ROUTE_SCOPES`, and the dispatch wiring in
`daemon-control.ts` are removed. A `no-daemon-control-metrics.test.ts`
guard mirrors the prior five guards and prevents the file from being
reintroduced under `src/core/daemon/`.

## Constraints

- Use the same `KotaModule.controlRoutes` seam used by every prior
  daemon-control route migration; do not invent a parallel registration
  path.
- Preserve the route as `GET /metrics` and the response shape exactly.
  Prometheus scrapers depend on stable label and metric names — no
  renames in the same change.
- Do not break the `WorkflowMetricsEmitter` OTLP path. The new handler
  is a sibling of the emitter, not a replacement.
- Do not import `#modules/*` from `src/core/`. The
  `no-module-imports-in-core` guard must stay green.
- Keep the route registration list in `src/modules/tracing/index.ts`
  short and discoverable; follow the file layout used by
  `src/modules/scheduler/routes.ts` and `src/modules/commands/routes.ts`.
- Tracing module load order must produce a daemon that exposes
  `GET /metrics` from the moment the control server starts. If the
  tracing module currently registers later in the load order, fix the
  declared dependencies rather than papering over the gap.
- Keep the file size guidance from `AGENTS.md`: routes file under
  ~300 LOC, no copy of metric-formatting logic in two places.

## Done When

- `daemon-control-metrics.ts` no longer exists under
  `src/core/daemon/` and the `GET /metrics` entry is gone from
  `BUILTIN_ROUTE_SCOPES`.
- `src/modules/tracing/` contains the moved handler (e.g. as
  `src/modules/tracing/routes.ts`) plus a focused unit test that
  covers the rendered Prometheus body for a representative
  `DaemonControlHandle` fixture.
- A `src/core/daemon/no-daemon-control-metrics.test.ts` regression
  guard exists, mirroring the existing five
  `no-daemon-control-*.test.ts` guards.
- `src/modules/tracing/AGENTS.md` records that the tracing module
  owns the `GET /metrics` route, alongside its existing OTLP scope.
- `pnpm typecheck`, `pnpm test`, `pnpm lint`, and the daemon start
  smoke test all pass.
- Curling `GET /metrics` against a running daemon returns the same
  metric names, labels, and body as before the migration for an
  equivalent runtime state.

## Source / Intent

Queue-shaping signal: 7 of the last 14 commits on `main` are the
`Seed empty queue with p2 task to move ... out of core` →
`Move ... out of core into the <name> module` pair (history,
approvals, owner-questions, push-tokens, commands, scheduler routes,
static web UI). Architecture intent in `src/AGENTS.md` and
`src/core/daemon/AGENTS.md`: capability-specific routes belong in the
owning module; modules extend the control API through
`KotaModule.controlRoutes`. Tracing already owns observability; the
Prometheus handler is the last observability-specific surface still
living in core daemon.

## Initiative

Module-first / core-shrinking: collapse all module-shaped surfaces out
of `src/core/daemon/` into their owning modules so the daemon kernel
keeps only protocol, lifecycle, session/workflow hosting, and shared
runtime primitives.

## Acceptance Evidence

- The migration commit pair (seed task already merged, then the
  follow-up "Move Prometheus /metrics out of core" commit).
- `git ls-files | grep daemon-control-metrics` returns empty under
  `src/core/daemon/`.
- The new tracing-module unit test for the route, asserting the same
  Prometheus body shape as the existing core test fixture.
- A captured `curl -s http://127.0.0.1:<port>/metrics` snapshot from a
  daemon running with the migrated module, attached to the run
  artifact, showing identical metric families to a pre-migration
  snapshot.
- The new `no-daemon-control-metrics.test.ts` guard, run as part of
  `pnpm test`.
