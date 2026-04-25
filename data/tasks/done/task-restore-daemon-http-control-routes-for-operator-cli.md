---
id: task-restore-daemon-http-control-routes-for-operator-cli
title: Restore daemon HTTP control routes so operator CLI works against a running daemon
status: done
priority: p1
area: architecture
summary: A running KOTA daemon currently serves 404 for every /api/* control route, breaking every CLI subcommand migrated to KotaClient whenever the daemon is up; restore the registered routes and add an integration test that fails if a healthy daemon does not serve its module-contributed control routes.
created_at: 2026-04-25T22:55:30.000Z
updated_at: 2026-04-26T00:05:00.000Z
---

## Problem

On the current `main` (HEAD `ab1eb6ab`) a running daemon does not
serve any of its module-contributed HTTP control routes. The
daemon process is healthy (the workflow runtime is completing
runs and `daemon-state.json` shows `completedRuns: 1720`), but
every authenticated `/api/*` request from a CLI subcommand
returns `404 {"error":"Not found"}`.

Reproduction observed during the 2026-04-25 explorer run
(`.kota/runs/2026-04-25T22-51-25-793Z-explorer-v7kjeg`):

- Daemon discovered through `.kota/daemon-control.json`
  (`port: 60303`, healthy bearer token, `pid: 37840`,
  `completedRuns: 1720`, `lastCompletedStatus: "success"`).
- `pnpm kota task list -s backlog` prints `No tasks found.`
  while `data/tasks/backlog/` actually contains a tracked task
  file.
- `pnpm kota task create "Smoke test" --state backlog` exits
  with `Fatal: Not found`.
- `pnpm kota task move <id> ready` exits with `Task "<id>" not
  found in any state directory`.
- Direct probes confirm the symptom is daemon-side, not CLI-
  side:
  - `curl -H "Authorization: Bearer ..." http://localhost:60303/api/tasks`
    → `404 {"error":"Not found"}`.
  - The same status is returned for `/`, `/api`, and
    `/api/workflows`.
- `inspect-queue` (the explorer workflow tool) still returns the
  correct counts because it reads the queue directly, not
  through HTTP. So the regression is exclusive to
  daemon-mediated client traffic.

This empirically contradicts the parity claim made by the
just-shipped CLI migration cluster (commits `2c269a35`
through `ab1eb6ab`). Every operator subcommand migrated to
`ctx.client.<namespace>.<method>()` silently fails as soon as
a daemon is running, which is the default state on operator
machines after `kota daemon-ops install`.

The remaining-CLI cluster task
(`task-migrate-operator-cli-utilities-and-add-kota-read-g`)
adds the *static guard* against direct `.kota/` reads, but it
does not detect this dynamic regression and should not be
expanded to do so — its scope is the static invariant, this
task's scope is the runtime contract.

## Desired Outcome

- A running daemon serves every module-contributed HTTP control
  route under bearer auth. Concretely, after
  `pnpm kota daemon-ops start`, the following must succeed:
  - `GET /api/tasks` (status snapshot)
  - `POST /api/tasks/normalized` (create)
  - `PATCH /api/tasks/<id>/move` (move)
  - The equivalent `/api/*` endpoints contributed by every
    other module currently registered.
- `pnpm kota task list`, `task create`, `task move`,
  `workflow list`, `approval list`, `secrets list`, `memory
  list`, etc. all behave identically against a running daemon
  and a stopped daemon.
- The repair is structural — fix the route registration path
  the daemon uses on boot, not patch each subcommand to detect
  daemon failure. No new fallback shim that re-implements the
  local path inside CLI code.
- A new integration test fails on a daemon whose modules are
  loaded but whose control routes are not registered. The test
  starts a real daemon (or a thin runtime equivalent) and
  asserts that representative `/api/*` routes from at least
  three modules respond 2xx for valid requests rather than 404.

## Constraints

- Do not silently fall back to the local client when a daemon
  is up but returning 404 — that would mask future regressions
  of this same shape. Surfacing the daemon's own failure to a
  fixable error is preferred.
- Do not introduce a parallel HTTP route registry. There is one
  daemon control plane; this fix belongs inside it.
- Keep the integration test deterministic and offline — no
  external network. Use the existing daemon fixture pattern in
  `src/daemon.integration.test.ts` rather than spawning a real
  shell daemon if a thinner harness already covers route
  registration.
- This task must land before the operator-CLI cluster task
  (`task-migrate-operator-cli-utilities-and-add-kota-read-g`)
  can produce honest daemon-up parity transcripts. The cluster
  task's "daemon-up CLI transcripts" acceptance is currently
  vacuous.

## Done When

- `pnpm kota` operator subcommands route through the daemon and
  return real results when a daemon is running, matching their
  daemon-down output. Captured under the run directory as
  paired transcripts.
- A focused integration test fails on the current HEAD's
  symptom (no routes registered → 404 across `/api/*`) and
  passes after the fix. The test exercises at least three
  module-contributed namespaces.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- The daemon's route-registration boot path is traceable from
  `src/core/daemon/daemon.ts` to each module's
  `routes()`/`localClient(ctx)` contribution without a special-
  case shim.

## Source / Intent

Empirical regression observed at run time during the
2026-04-25 explorer step, with the verbatim repro recorded
above. The recently-merged CLI migration cluster claimed
daemon-up parity but the parity transcripts were not actually
captured against a running daemon — this task closes that
gap.

Run directory:
`.kota/runs/2026-04-25T22-51-25-793Z-explorer-v7kjeg`.

## Initiative

Product-grade KOTA clients: a single daemon control contract
that the CLI, native/web/mobile apps, and future operator
clients all consume the same way, with the CLI as the
reference interactive client. A parity claim is only honest if
the daemon-up path actually works.

## Acceptance Evidence

- Diff covering the route-registration fix in
  `src/core/daemon/` (or wherever the boot path resolves
  module contributions) plus the new integration test.
- New integration test transcript showing the test fails on
  the pre-fix tree and passes after the fix.
- Paired CLI transcripts (daemon-up, daemon-down) for at least
  `kota task list`, `kota workflow list`, and one mutation
  (`kota task create` or `kota task move`), recorded under the
  run directory.
- A short note in the run audit confirming the original
  symptom (curl `/api/tasks` against the running daemon
  returning 404) is no longer reproducible after the fix.
