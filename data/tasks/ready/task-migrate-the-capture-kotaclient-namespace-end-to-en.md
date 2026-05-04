---
id: task-migrate-the-capture-kotaclient-namespace-end-to-en
title: Migrate the capture KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move CaptureClient interface and CaptureFilter/CaptureTarget/CaptureRecord/CaptureResult discriminated types from src/core/server/kota-client.ts into src/modules/capture/client.ts; add a daemonClient(link) factory to the capture module that POSTs to /capture through the typed DaemonTransport; remove captureHttp and the inline capture handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-04T13:05:25.600Z
updated_at: 2026-05-04T13:05:25.600Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), and the web migration (`f79a2ee5`,
2026-05-04) have validated the `daemonClient(link)` foundation pattern
by moving twelve namespaces out of `src/core/server/kota-client.ts`
and `src/core/server/daemon-client.ts` into their owning modules. 15
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1377 lines,
`daemon-client.ts` is 1872 lines, both still well over the 300-line
guideline).

After the web migration retired the stub-only contribution path from
core, every remaining centralized namespace in `daemon-client.ts`
issues at least one wire call. The next-cleanest namespace that fits
the same end-to-end shape is `capture`:

- 1 method (`capture(text, filter?)`) — same single-method surface as
  the retract migration's `retract(request)` shape.
- Already owned by a dedicated module under `src/modules/capture/`
  with its own `localClient(ctx)` factory (`index.ts`), control routes
  (`captureControlRoutes`, registered against the daemon at
  `/capture` in `routes.ts`), provider layer (`capture-provider.ts`),
  contributors (`contributors.ts`), CLI (`cli.ts`), tool (`tool.ts`),
  and dynamic state contributor (`system-prompt.ts`).
- ~95 lines of namespace-owned types in `kota-client.ts` (lines
  665–772 minus shared doc-block context):
  - `CaptureTarget` (line 670, 1 line): the
    `"memory" | "knowledge" | "tasks" | "inbox"` discriminated union.
  - `CaptureMemoryRecord` (lines 673–676, 4 lines).
  - `CaptureKnowledgeRecord` (lines 679–682, 4 lines).
  - `CaptureTasksRecord` (lines 685–689, 5 lines).
  - `CaptureInboxRecord` (lines 692–696, 5 lines).
  - `CaptureRecord` (lines 705–709, 5 lines): the discriminated record
    union over the four target arms.
  - `CaptureFilter` (lines 720–723, 4 lines): the optional
    `{ target?, hint? }` wrapper.
  - `CaptureResult` (lines 745–758, 14 lines): the four-arm
    discriminated envelope (`ok: true` plus three `ok: false`
    `reason` arms — `ambiguous`, `no_contributors`,
    `contributor_failed`).
  - `CaptureClient` (lines 770–772, 3 lines).
  - The supporting doc comments (lines 665–669, 672, 678, 684, 691,
    698–704, 711–719, 725–744, 760–769).
- ~17 lines of wire code in `daemon-client.ts` —
  `captureHttp` (lines 164–179) plus the inline
  `capture: { capture: ... }` closure on the central handler builder
  (lines 1523–1525) plus the `CaptureFilter`/`CaptureResult` imports.
- The wire code already POSTs JSON to `/capture` and decodes the
  typed `CaptureResult`; the factory body collapses into one
  strict POST against `/capture` once the typed `DaemonTransport`
  link supplies the JSON body shape.
- The capture route handler in `src/modules/capture/routes.ts`
  currently imports `CaptureFilter` / `CaptureResult` /
  `CaptureTarget` from `#core/server/kota-client.js`. After the
  migration these imports point at the module-local `client.ts`,
  mirroring the retract, answer, and ownerQuestions migrations. The
  module-local re-exports in `capture-types.ts` (lines 14–34) shift
  with them, as does every in-module consumer (`capture-provider.ts`,
  `cli.ts`, `cli.test.ts`, `render.ts`, `index.ts`, `routes.test.ts`).

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the retract migration. The single extra wrinkle vs retract
is that the discriminated `CaptureResult` is four arms (one ok plus
three distinct `reason` failures, including the `contributor_failed`
arm carrying both `target` and `message` fields) rather than retract's
three arms; both are already strictly typed.

## Desired Outcome

`capture` is the thirteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `CaptureClient`, `CaptureTarget`, `CaptureMemoryRecord`,
  `CaptureKnowledgeRecord`, `CaptureTasksRecord`,
  `CaptureInboxRecord`, `CaptureRecord`, `CaptureFilter`, and
  `CaptureResult` live in `src/modules/capture/client.ts`. The
  aggregate `KotaClient` interface in `src/core/server/kota-client.ts`
  imports `CaptureClient` from this module instead of declaring the
  types inline. The narrow `no-module-imports-in-core` allowlist
  (today: `server/kota-client.ts`) already covers the import; no
  allowlist edit is needed.
- `src/modules/capture/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ capture: CaptureClient }` whose `capture(text, filter)`
  method routes through
  `link.requestStrict<CaptureResult>("POST", "/capture", { text, ...(filter && { filter }) })`,
  matching today's `captureHttp` body shape byte-for-byte.
- `src/core/server/daemon-client.ts` no longer carries `captureHttp`,
  the inline `capture: { capture: ... }` closure on the core-side
  stub builder, the `CaptureFilter` / `CaptureResult` imports from
  `./kota-client.js`, or any other capture-specific code.
  Module-contributed handlers replace all of these the same way every
  prior migration did.
- `src/modules/capture/capture-types.ts` updates its imports and
  re-exports of `CaptureFilter`, `CaptureRecord`, `CaptureResult`,
  `CaptureTarget`, `CaptureInboxRecord`, `CaptureKnowledgeRecord`,
  `CaptureMemoryRecord`, and `CaptureTasksRecord` from
  `#core/server/kota-client.js` to the module-local `./client.js`.
  Every other in-module consumer of these types (`index.ts`,
  `capture-provider.ts`, `cli.ts`, `cli.test.ts`, `render.ts`,
  `routes.ts`, `routes.test.ts`) follows the same shift.
- A new daemon-side factory unit test alongside the module
  (`src/modules/capture/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/retract/daemon-client.test.ts` and
  `src/modules/answer/daemon-client.test.ts`. The test pins (1) the
  factory contributes `capture`, (2) `capture(text, filter)` routes
  through `requestStrict<T>` with method `POST`, path `/capture`, and
  body `{ text, filter }` (with `filter` omitted entirely when not
  provided, matching today's `captureHttp` byte-for-byte), (3) every
  `CaptureFilter` arm threads through the wire body unchanged
  (no-filter, target-only, hint-only, both-fields), (4) every
  `CaptureResult` arm decodes correctly through the
  `requestStrict<CaptureResult>` typed return (one `ok: true` arm with
  each of the four `CaptureRecord` discriminants plus the three
  `ok: false` reason arms), (5) the assembly satisfies coverage with
  the capture contribution, and (6) the assembly throws naming
  "capture" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"capture"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `capture` handler returning
  `{ ok: false, reason: "no_contributors" as const }` so tests that
  build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/capture` control route keeps its JSON body
  contract (`{ text, filter? }`) exactly as parsed by `parseFilter`
  in `src/modules/capture/routes.ts`. The public `POST /api/capture`
  route on the regular HTTP server is unrelated to this migration
  and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The JSON body shape
  matches today's `captureHttp` byte-for-byte: `{ text }` when no
  filter is provided, `{ text, filter }` when one is — the spread
  pattern `{ text, ...(filter && { filter }) }` from the existing
  wire code is preserved verbatim so the daemon never sees a
  `filter: undefined` field.
- No legacy or compatibility surface. Delete `captureHttp`, the
  inline closure, the central type declarations, and the
  `CaptureFilter`/`CaptureResult` imports at the migration's edges
  as it completes; do not leave shims. The in-module import shifts
  in `capture-types.ts` (and every other in-module consumer) from
  `#core/server/kota-client.js` to `./client.js` are hard cutovers,
  not parallel re-exports.
- The four-arm `CaptureResult` discriminated union is preserved
  exactly: `{ ok: true; record: CaptureRecord }`,
  `{ ok: false; reason: "ambiguous"; suggestions: ReadonlyArray<CaptureTarget> }`,
  `{ ok: false; reason: "no_contributors" }`, and
  `{ ok: false; reason: "contributor_failed"; target: CaptureTarget; message: string }`.
  None of these arms are removed or renamed. The four-arm
  `CaptureRecord` discriminated union (memory / knowledge / tasks /
  inbox, with their typed `recordId` and per-arm `path` metadata)
  is preserved exactly.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `CaptureFilter` / `CaptureTarget` / `CaptureRecord`
  / `CaptureResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, modulesAdmin, agents, skills, mcpServer,
  and web migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota capture <text>` and its
  `--target` / `--hint` flags), daemon-up vs daemon-down branching,
  web-client behavior against `/api/capture`, agent-tool behavior,
  dynamic-state contributor behavior, and `--json` output all
  continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  capture module's existing rendering hooks (`render.ts`) are not
  part of this refactor.

## Done When

- `src/modules/capture/client.ts` exists and declares
  `CaptureClient`, `CaptureTarget`, `CaptureMemoryRecord`,
  `CaptureKnowledgeRecord`, `CaptureTasksRecord`,
  `CaptureInboxRecord`, `CaptureRecord`, `CaptureFilter`, and
  `CaptureResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `CaptureClient` from
  this module.
- `src/modules/capture/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/capture/capture-types.ts` re-exports the
  capture-namespace types from `./client.js` (not from
  `#core/server/kota-client.js`). Every other in-module consumer
  (`index.ts`, `capture-provider.ts`, `cli.ts`, `cli.test.ts`,
  `render.ts`, `routes.ts`, `routes.test.ts`) follows the same
  shift.
- `src/core/server/daemon-client.ts` no longer carries any
  `capture`-specific code: no `captureHttp`, no inline
  `capture: { capture: ... }` closure on the core-side stub
  builder, no `CaptureFilter` / `CaptureResult` imports, and no
  other capture-specific helpers.
- `src/modules/capture/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire shape with method/path/body assertions, per-arm
  `CaptureFilter` body threading covering no-filter, target-only,
  hint-only, both-fields, per-arm `CaptureResult` decoding covering
  every `ok: true` `CaptureRecord` discriminant plus the three
  `ok: false` reason arms, coverage success when the contribution
  is supplied, and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"capture"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `capture` handler returning
  `{ ok: false, reason: "no_contributors" as const }`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `CaptureFilter`
  / `CaptureResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`capture-daemon-up.txt` / `capture-daemon-down.txt`) demonstrate
  parity for one mutation (`kota capture --target inbox <text>`)
  showing the pre/post output is identical across modes. Capture is
  mutating, so the transcript exercises the mutation arm explicitly
  rather than only a list-style read.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-04T13-02-20-570Z-explorer-im814c/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Fourteen orthogonal preludes have already landed (twelve foundation/
pilot/migration commits plus the mcpServer and web stub-only
migrations):

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace.
- `8c212f0c` — retract migration extending the pattern to a JSON-body
  POST with discriminated request/result unions.
- `eb392cd1` — answer migration extending the pattern to a multi-verb
  namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern to two
  POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern to the
  first multi-namespace contribution from a single module's
  `daemonClient(link)` factory and the first cross-namespace
  dependency consumption.
- `7965beb6` — agents migration extending the pattern to the first
  pure read-only namespace shape (two GETs) and validating the
  single-status-code → 200 alignment precedent for `404 →
  { found: false }`.
- `f62bbb65` — skills migration extending the pattern to the first
  multi-status-code → 200 alignment for a typed mutation result
  (collapsing `502` and `400` not-ok arms into uniform `200`).
- `10877651` — mcpServer migration establishing the stub-only daemon-
  side handler precedent: the first namespace whose
  `daemonClient(_link)` factory ignores the link transport and
  returns a fixed constant refusal.
- `f79a2ee5` — web migration generalizing the stub-only precedent to
  a second independent module and retiring the stub-only contribution
  path from core's responsibilities; every remaining centralized
  namespace in `daemon-client.ts` now issues at least one wire call.

`capture` is the next-cleanest single-method namespace whose entire
daemon contract is a single POST with a discriminated body and a
discriminated return envelope — the natural next pilot in the cluster
that began with the retract and answer migrations. It extends the
pattern in one axis the prior pilots did not exercise: a four-arm
`CaptureResult` discriminated union (one ok arm with a four-arm
`CaptureRecord` sub-union, plus three distinct `ok: false` `reason`
arms with per-arm payload fields including the `contributor_failed`
arm's `target` and `message`), one axis richer than retract's three-
arm result. It is needed under every chunking answer the owner can
pick (a/b/c/d/unblock): the capture namespace migrates exactly once
regardless of whether the parent lands in one cohesive run or fans
out across follow-ups, so this task does not commit the owner to any
specific chunking answer; it shrinks the parent task's scope by one
full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `captureModule`, the in-module import shift in `capture-types.ts`
  (and every other in-module consumer of the capture-namespace
  types), the removed `captureHttp` plus inline closure plus
  imports from `src/core/server/daemon-client.ts`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~95-line and ~20-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`capture-daemon-up.txt` / `capture-daemon-down.txt`) exercising
  one mutation (`kota capture --target inbox <text>`) with identical
  output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `CaptureFilter` /
  `CaptureResult` declaration in `src/core/server/`.
