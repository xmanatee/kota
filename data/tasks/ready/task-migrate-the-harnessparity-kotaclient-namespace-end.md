---
id: task-migrate-the-harnessparity-kotaclient-namespace-end
title: Migrate the harnessParity KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: ready
priority: p1
area: architecture
summary: Move HarnessParityClient interface, HarnessParityListResult, HarnessParityRunOptions, HarnessParityArtifactSummary, HarnessParityRunResult, and HarnessParityScenarioSummary from src/core/server/kota-client.ts into src/modules/harness-parity/client.ts; add a daemonClient(link) factory to the harness-parity module that calls /harness-parity/scenarios and /harness-parity/run through the typed DaemonTransport; remove listHarnessParityScenariosHttp, runHarnessParityHttp, and the inline harnessParity handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T07:05:08.000Z
updated_at: 2026-05-03T07:05:08.000Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03) validated the
`daemonClient(link)` foundation pattern by moving the smallest namespace
out of `src/core/server/kota-client.ts` and `src/core/server/
daemon-client.ts` into the doctor module. 22 namespaces still have their
TypeScript shape and daemon-side wire code centralized in those two files.
The next-smallest namespace that fits the same end-to-end shape is
`harnessParity`:

- 2 methods (`list`, `run`) — same surface area as `doctor` (`run`, `fix`).
- Already owned by a dedicated module under `src/modules/harness-parity/`
  with its own `localClient(ctx)` factory, control routes
  (`harnessParityControlRoutes`), and operations layer
  (`harness-parity-operations.ts`).
- ~70 lines of namespace-owned types in `kota-client.ts` (lines 1873–1944:
  `HarnessParityScenarioSummary`, `HarnessParityListResult`,
  `HarnessParityRunOptions`, `HarnessParityArtifactSummary`,
  `HarnessParityRunResult`, `HarnessParityClient`).
- ~30 lines of wire code in `daemon-client.ts`
  (`listHarnessParityScenariosHttp`, `runHarnessParityHttp`) plus the
  inline `harnessParity: { list, run }` closure on the central handler
  builder, plus the field declaration and assignment in the
  `DaemonControlClient` class.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — exactly the same
shape as the doctor pilot.

## Desired Outcome

`harnessParity` is the second namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `HarnessParityClient`, `HarnessParityListResult`,
  `HarnessParityRunOptions`, `HarnessParityArtifactSummary`,
  `HarnessParityRunResult`, and `HarnessParityScenarioSummary` live in
  `src/modules/harness-parity/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `HarnessParityClient` from the module instead of declaring the types
  inline.
- `src/modules/harness-parity/index.ts` exposes a
  `daemonClient(link)` factory parallel to its existing
  `localClient(ctx)` factory. The factory returns
  `{ harnessParity: HarnessParityClient }` backed by
  `link.requestStrict<...>` calls against `/harness-parity/scenarios` and
  `/harness-parity/run`.
- `src/core/server/daemon-client.ts` no longer carries
  `listHarnessParityScenariosHttp`, `runHarnessParityHttp`, the inline
  `harnessParity: { list, run }` closure on the core-side stub, the
  `harnessParity` field declaration on `DaemonControlClient`, or the
  `this.harnessParity = handlers.harnessParity;` assignment in the
  constructor. Module-contributed handlers replace all of these the same
  way the doctor pilot did.
- The existing `harness-parity` module test (`runner.test.ts` /
  `harness-parity-operations.test.ts`) continues to pass; a new unit test
  alongside the daemon-side factory exercises the wire shape against a
  mock `DaemonTransport`, mirroring `src/modules/doctor/
  daemon-client.test.ts`.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or wire
  shape — `/harness-parity/scenarios` (GET) and `/harness-parity/run`
  (POST) keep their request/response bodies exactly as they are today.
- The daemon-side handler uses `link.requestStrict<T>(method, path, body?)`
  through the typed `DaemonTransport`. It does not reach into
  `node:http`, the bearer token, or `.kota/daemon-control.json`.
- The 400-response branch in `runHarnessParityHttp` (which returns the
  typed `{ ok: false; reason; message }` shape rather than throwing) must
  be preserved. The strict request helper either accepts a
  body-on-non-2xx contract or the daemonClient factory handles the
  status-400 branch explicitly so the typed `HarnessParityRunResult`
  discriminator continues to round-trip end-to-end.
- No legacy or compatibility surface. Delete the central wire functions,
  closure, field, and assignment as the migration completes; do not leave
  shims.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts` must reject
  any per-namespace `HarnessParity*` declaration left under
  `src/core/server/`; existing assertions stay green for the doctor pilot
  and extend to harness-parity automatically since the guard scans by
  pattern.
- No protocol change. CLI behavior (`kota harness-parity ...`),
  daemon-up vs daemon-down branching, JSON output, and
  `harnessParityControlRoutes` registration all continue to behave
  identically.
- Output continues to flow through `src/modules/rendering`. The
  `harness-parity` module's existing rendering hooks are not part of this
  refactor.

## Done When

- `src/modules/harness-parity/client.ts` exists and declares
  `HarnessParityClient`, `HarnessParityListResult`,
  `HarnessParityRunOptions`, `HarnessParityArtifactSummary`,
  `HarnessParityRunResult`, and `HarnessParityScenarioSummary`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `HarnessParityClient` from this module.
- `src/modules/harness-parity/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/core/server/daemon-client.ts` no longer carries any
  `harnessParity`-specific code: no `listHarnessParityScenariosHttp`, no
  `runHarnessParityHttp`, no inline `harnessParity: { list, run }`
  closure on the core-side stub builder, no `harnessParity` field on
  `DaemonControlClient`, and no constructor assignment for it.
- A new daemon-side factory unit test alongside the module's
  `daemon-client.test.ts` (or a new
  `harness-parity-daemon-client.test.ts`) covers the wire shape for both
  `list` and `run`, including the typed `{ ok: false }` 400-response
  branch.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects a deliberately re-introduced per-namespace `HarnessParity*`
  declaration in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  demonstrate parity for one read (`kota harness-parity list`) and one
  mutation (`kota harness-parity run --scenarios <id>`) showing the
  pre/post output is identical.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T07-01-58-838Z-explorer-9x9vll/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-decision
slot `kotaclient-namespace-distribution-chunking` open since 2026-04-26).

Three orthogonal foundation extractions have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-method
  decoupling (the orthogonal prelude needed under all chunking answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and the
  per-namespace types guard (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace end-to-end
  through the new hook, validating the pattern.

`harnessParity` is the second-smallest namespace and the natural
follow-on pilot. It is needed under every chunking answer the owner can
pick (a/b/c/d/unblock): the harnessParity namespace migrates exactly once
regardless of whether the parent lands in one cohesive run or fans out
across follow-ups, so this task does not commit the owner to any specific
chunking answer; it shrinks the parent task's scope by one full namespace
whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols and
runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient` factory on
  `harnessParityModule`, and the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~70-line and ~35-line shrinkage.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`harness-parity-daemon-up.txt` / `harness-parity-daemon-down.txt`)
  showing one read (`kota harness-parity list`) and one mutation
  (`kota harness-parity run --scenarios <id> --harnesses <name>`) with
  identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current tree
  and fails on a deliberately re-introduced
  `HarnessParityScenarioSummary` declaration in `src/core/server/`.
