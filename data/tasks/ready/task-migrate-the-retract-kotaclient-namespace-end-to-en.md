---
id: task-migrate-the-retract-kotaclient-namespace-end-to-en
title: Migrate the retract KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: ready
priority: p1
area: architecture
summary: Move RetractClient interface, RetractTarget/RetractRecord/RetractRequest/RetractResult discriminated types, and the per-target *Record arms from src/core/server/kota-client.ts into src/modules/retract/client.ts; add a daemonClient(link) factory to the retract module that POSTs to /retract through the typed DaemonTransport; remove retractHttp and the inline retract handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T08:17:43.463Z
updated_at: 2026-05-03T08:17:43.463Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), and the audit migration
(commit `b6278cf1`, 2026-05-03) validated the `daemonClient(link)`
foundation pattern by moving the three smallest namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 20 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files.

The next-cleanest namespace that fits the same end-to-end shape is
`retract`:

- 1 method (`retract(request)`) — same single-method surface as the
  audit migration's `list` shape.
- Already owned by a dedicated module under `src/modules/retract/`
  with its own `localClient(ctx)` factory, control routes
  (`retractControlRoutes`, registered against the daemon at
  `/retract`), provider layer (`retract-provider.ts`), contributors
  (`contributors.ts`), CLI (`cli.ts`), tool (`tool.ts`), and dynamic
  state contributor (`system-prompt.ts`).
- ~125 lines of namespace-owned types in `kota-client.ts`
  (lines 911–1036: `RetractTarget`, `RetractMemoryRecord`,
  `RetractKnowledgeRecord`, `RetractTasksRecord`,
  `RetractInboxRecord`, `RetractRecord`, `RetractRequest`,
  `RetractResult`, `RetractClient`).
- ~22 lines of wire code in `daemon-client.ts` —
  `retractHttp` (lines 272–286) plus the inline
  `retract: { retract: ... }` closure on the central handler builder
  (lines 1906–1908) plus the `RetractRequest`/`RetractResult` imports.
- The wire code already POSTs JSON to `/retract` and decodes the
  typed `RetractResult`; the factory body collapses into one
  strict POST against `/retract` once the typed `DaemonTransport`
  link supplies the JSON body shape.
- The retract route handler in `src/modules/retract/routes.ts`
  currently imports `RetractRequest` / `RetractResult` from
  `#core/server/kota-client.js`. After the migration these imports
  point at the module-local `client.ts`, mirroring the doctor and
  audit pilots.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the doctor, harnessParity, and audit pilots. The single
extra wrinkle vs audit is that the wire body is a JSON `RetractRequest`
discriminated union rather than a query string, and the response is a
discriminated `RetractResult` rather than a list shape; both are
already strictly typed.

## Desired Outcome

`retract` is the fourth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `RetractClient`, `RetractTarget`, `RetractMemoryRecord`,
  `RetractKnowledgeRecord`, `RetractTasksRecord`,
  `RetractInboxRecord`, `RetractRecord`, `RetractRequest`, and
  `RetractResult` live in `src/modules/retract/client.ts`. The
  aggregate `KotaClient` interface in `src/core/server/kota-client.ts`
  imports `RetractClient` from the module instead of declaring the
  types inline. The narrow `no-module-imports-in-core` allowlist
  extends to the new file by the same single-pattern allowance the
  doctor pilot established.
- `src/modules/retract/index.ts` exposes a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ retract: RetractClient }` backed by
  `link.requestStrict<RetractResult>("POST", "/retract", request)`
  (or the equivalent typed body helper the foundation exposes).
- `src/core/server/daemon-client.ts` no longer carries `retractHttp`,
  the inline `retract: { retract: ... }` closure on the core-side
  stub, the `RetractRequest` / `RetractResult` imports, or any other
  retract-specific code. Module-contributed handlers replace all of
  these the same way the doctor, harnessParity, and audit migrations
  did.
- `src/modules/retract/routes.ts` updates its `RetractRequest` /
  `RetractResult` imports from `#core/server/kota-client.js` to the
  module-local `./client.js`, mirroring the analogous import shifts
  the doctor and audit migrations made for their per-namespace types.
- A new daemon-side factory unit test alongside the module
  (`src/modules/retract/daemon-client.test.ts`) exercises the wire
  shape against a mock `DaemonTransport`, mirroring `src/modules/
  doctor/daemon-client.test.ts`, `src/modules/harness-parity/
  daemon-client.test.ts`, and `src/modules/guardrails-audit/
  daemon-client.test.ts`. The test pins (1) the factory exists, (2)
  `retract` routes through `requestStrict<T>` with a POST and a JSON
  body, (3) every `RetractRequest` arm threads through the wire body
  unchanged, (4) the assembly satisfies coverage with the retract
  contribution, and (5) the assembly throws naming "retract" when
  the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"retract"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `retract` handler so tests that build a `DaemonControlClient` purely
  to exercise non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/retract` control route keeps its JSON body
  contract (`{ target, id|slug|path, ... }`) exactly as parsed by
  `parseRetractRequestBody` in `src/modules/retract/routes.ts`. The
  public `POST /api/retract` route on the regular HTTP server is
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The JSON body shape
  matches today's `retractHttp` byte-for-byte (no opportunistic
  field reshaping, no per-arm body normalization).
- No legacy or compatibility surface. Delete `retractHttp`, the
  inline closure, the central type declarations, and the
  `RetractRequest`/`RetractResult` imports at the migration's edges
  as it completes; do not leave shims. The `routes.ts` import shift
  from `#core/server/kota-client.js` to the module-local
  `./client.js` is a hard cutover, not a parallel re-export.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `RetractTarget` / `RetractRecord` / `RetractRequest`
  / `RetractResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, and audit migrations
  stay green.
- The existing `no-module-imports-in-core` guard (under
  `src/core/agent-harness/`) is extended by adding the new
  `src/modules/retract/client.ts` to the same narrow file-scoped
  allowlist the doctor pilot established. The sibling assertion
  that the allowlist itself stays load-bearing as namespaces
  continue to migrate must continue to hold.
- No protocol change. CLI behavior (`kota retract <target> <id>`),
  daemon-up vs daemon-down branching, web-client behavior against
  `/api/retract`, agent-tool behavior, dynamic-state contributor
  behavior, and `--json` output all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  retract module's existing rendering hooks (`render.ts`) are not
  part of this refactor.

## Done When

- `src/modules/retract/client.ts` exists and declares `RetractClient`,
  `RetractTarget`, `RetractMemoryRecord`, `RetractKnowledgeRecord`,
  `RetractTasksRecord`, `RetractInboxRecord`, `RetractRecord`,
  `RetractRequest`, and `RetractResult`. The `KotaClient` aggregate
  in `src/core/server/kota-client.ts` imports `RetractClient` from
  this module.
- `src/modules/retract/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/retract/routes.ts` imports `RetractRequest` and
  `RetractResult` from `./client.js` (not from `#core/server/
  kota-client.js`). Every other in-module consumer of these types
  (provider, contributors, tool, system-prompt, render, CLI, tests)
  follows the same shift.
- `src/core/server/daemon-client.ts` no longer carries any
  `retract`-specific code: no `retractHttp`, no inline `retract: {
  retract: ... }` closure on the core-side stub builder, no
  `RetractRequest` / `RetractResult` imports, and no other
  retract-specific helpers.
- `src/modules/retract/daemon-client.test.ts` exists and covers the
  wire shape, per-arm body threading (memory/knowledge/tasks/inbox),
  result-shape decoding (every `RetractResult` arm), coverage
  success, and coverage failure when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"retract"`, and
  `buildMigratedNamespaceTestStubs()` in `src/core/server/daemon-
  client-test-stubs.ts` extends with a stub `retract` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `RetractRequest`
  / `RetractResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`retract-daemon-up.txt` / `retract-daemon-down.txt`) demonstrate
  parity for one read-then-mutate sequence (capture an inbox note,
  then `kota retract inbox <path>`) showing the pre/post output is
  identical. Retract is mutating, so the transcript exercises the
  mutation arm explicitly rather than only a list-style read.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T08-14-35-409Z-explorer-01g969/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Five orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook, validating the pattern.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace, confirming the per-namespace shape
  generalizes.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace, confirming the shape generalizes
  across read-only `GET` namespaces.

`retract` is the next-cleanest single-method namespace and the
natural next pilot. It extends the pattern in one axis the prior
three pilots did not exercise: a JSON-body POST with a discriminated
request union and a discriminated result union, both already
strictly typed. It is needed under every chunking answer the owner
can pick (a/b/c/d/unblock): the retract namespace migrates exactly
once regardless of whether the parent lands in one cohesive run or
fans out across follow-ups, so this task does not commit the owner
to any specific chunking answer; it shrinks the parent task's scope
by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient` factory on
  `retractModule`, the in-module import shift in `routes.ts` (and
  any other in-module consumer of `RetractRequest` /
  `RetractResult`), and the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~125-line and ~22-line shrinkage.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`retract-daemon-up.txt` / `retract-daemon-down.txt`) exercising
  one mutation (capture a temporary inbox note, then `kota retract
  inbox <path>`) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `RetractRequest` / `RetractResult` declaration in
  `src/core/server/`.
