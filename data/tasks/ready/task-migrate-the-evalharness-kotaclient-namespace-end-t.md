---
id: task-migrate-the-evalharness-kotaclient-namespace-end-t
title: Migrate the evalHarness KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move EvalHarnessClient interface and the EvalFixtureSummary/EvalListResult/EvalRunOptions/EvalRunResult/EvalCalibrationOptions/EvalCalibrationResult types from src/core/server/kota-client.ts into src/modules/eval-harness/client.ts; add a daemonClient(link) factory to the eval-harness module that wires GET /eval/list, POST /api/eval/run, GET /eval/calibration through the typed DaemonTransport; remove evalListHttp/evalRunHttp/evalCalibrationHttp and the inline evalHarness handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-05T03:43:44.450Z
updated_at: 2026-05-05T03:43:44.450Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), the recall migration (`5ab2bd0b`), the
webhook migration (`201d35ce`), the approvals migration (`e0030ada`),
the secrets migration (`5841c7f0`), the memory migration (`5bcc9e24`),
the knowledge migration (`d346a5c7`), and the history migration
(`a38978c8`, 2026-05-05) have validated the `daemonClient(link)`
foundation pattern by moving twenty namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 7 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 776 lines, `daemon-client.ts` is 1284 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `evalHarness`:

- 3 methods (`list()`, `run(options?)`, `calibration(options?)`) — a
  GET / POST / GET-with-query-string trio that exercises the same
  shape the doctor pilot established for a small read-write namespace.
- Already owned by a dedicated module under `src/modules/eval-harness/`
  with its own `localClient(ctx)` factory (`index.ts` lines 148–161),
  control routes (`evalHarnessControlRoutes()` registered against the
  daemon at `/eval/list` GET and `/eval/calibration` GET in
  `eval-control-routes.ts`), an API route (`evalHarnessRoutes()` at
  `/api/eval/run` POST in `routes.ts`), and CLI (`buildEvalCommand` in
  `cli.ts`).
- ~80 lines of namespace-owned types in `kota-client.ts` (lines
  604–683):
  - `EvalFixtureSummary` (lines 605–611, 7 lines): the `{ id,
    description, role, workflowName, tags }` per-fixture summary.
  - `EvalListResult` (lines 613–615, 3 lines): the `{ fixtures:
    EvalFixtureSummary[] }` aggregate result.
  - `EvalRunOptions` (lines 623–632, 10 lines): the optional
    `fixtureIds`, `repeatCount`, `hostClass`, `cpuAllocationCores`,
    `cpuKillThresholdCores`, `memoryAllocationMB`,
    `memoryKillThresholdMB`, `keepWorkingDirs` request options.
  - `EvalRunResult` (lines 634–644, 11 lines): the three-arm
    `{ ok: true; fixtureCount; repeatCount; passAtK; passHatK;
    runArtifactBaseDir } | { ok: false; reason: "no_fixtures";
    message } | { ok: false; reason: "fixture_provenance"; message }`
    discriminated union.
  - `EvalCalibrationOptions` (lines 651–657, 7 lines): the optional
    `windowDays`, `followUpDays`, `thresholdRate`, `minSample`,
    `runsDir` query-string filter.
  - `EvalCalibrationResult` (lines 664–667, 4 lines): the `{ aggregate:
    Record<string, unknown>; decision: Record<string, unknown> }`
    plain-record pass-through.
  - `EvalHarnessClient` (lines 679–683, 5 lines).
  - The supporting doc comments (lines 604, 617–622, 646–650, 659–663,
    669–678).
- ~62 lines of wire code in `daemon-client.ts` —
  `evalListHttp` (lines 200–211, 12 lines),
  `evalRunHttp` (lines 213–240, 28 lines),
  `evalCalibrationHttp` (lines 242–261, 20 lines),
  plus the inline `evalHarness: { list, run, calibration }` closure on
  the central handler builder (lines 958–962, 5 lines), plus the
  `EvalCalibrationOptions` / `EvalCalibrationResult` / `EvalListResult` /
  `EvalRunOptions` / `EvalRunResult` imports from `./kota-client.js`
  (eval-namespace block in lines 17–45).
- The wire code today issues GET `/eval/list`,
  POST `/api/eval/run` (with the run options as the JSON body), and
  GET `/eval/calibration?windowDays=…&followUpDays=…&thresholdRate=…&
  minSample=…&runsDir=…` through `fetchWithTimeout` (list and
  calibration) plus raw `fetch` (run, since eval runs can take minutes
  and the default 2s timeout would abort them) plus
  `transport.authHeaders()` directly. The factory body collapses
  cleanly once the typed `DaemonTransport` link supplies the standard
  JSON-decode path: list and calibration use `requestStrict<T>`, and
  run either uses `requestStrict<T>` with a `timeoutMs` override (per
  `DaemonRequestInit.timeoutMs`) plus a daemon-route reshape from
  `400 + { error }` to `200 + { ok: false; reason; message }` (the
  skills precedent — see `## Desired Outcome` below for the full
  shape), or routes through `link.fetchRaw` to inspect `res.status`
  directly when the daemon route is left unchanged.
- The eval-harness module's local consumer (`index.ts`) currently
  imports `EvalHarnessClient` from `#core/server/kota-client.js`. After
  the migration this import points at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in three new
dimensions: (a) the first migration whose mutation path issues a
**long-running POST** that today drops the central `fetchWithTimeout`
wrapper entirely (eval runs frequently exceed the default 2s timeout —
they invoke the subprocess executor and stream fixture runs end-to-end),
validating that either `DaemonRequestInit.timeoutMs` cleanly threads
through the typed `DaemonTransport` for a long-running operation or
that `link.fetchRaw` is the right escape-hatch for unbounded daemon
calls; (b) the first migration whose error contract uses **regex-based
message discrimination** (`/no fixtures/i.test(msg)` chooses
`no_fixtures` over `fixture_provenance` for `400 + { error }`
responses), forcing an explicit choice between reshaping the daemon
route to return `200 + { ok: false; reason; message }` (the skills
precedent — `f62bbb65`'s "first multi-status-code → 200 alignment for
a typed mutation result") or threading the regex-on-message
discriminator through `link.fetchRaw`, with the chosen approach pinned
in the wire-shape test; and (c) the first migration whose contract
exposes a **`Record<string, unknown>` pass-through** result shape
(`EvalCalibrationResult.aggregate` and `EvalCalibrationResult.decision`
are plain JSON records to avoid coupling the contract to the autonomy
module's internal types), validating that `requestStrict<T>` cleanly
threads JSON pass-through types alongside discriminated-union results
that prior pilots already exercised.

## Desired Outcome

`evalHarness` is the twenty-first namespace to leave
`src/core/server/` end-to-end through the `daemonClient(link)`
foundation hook:

- `EvalHarnessClient`, `EvalFixtureSummary`, `EvalListResult`,
  `EvalRunOptions`, `EvalRunResult`, `EvalCalibrationOptions`, and
  `EvalCalibrationResult` live in
  `src/modules/eval-harness/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `EvalHarnessClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/eval-harness/index.ts` adds a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ evalHarness: EvalHarnessClient }` whose three
  methods route through:
  - `list()` → `link.requestStrict<EvalListResult>("GET", "/eval/list")`.
  - `run(options)` → the recommended approach is to reshape the
    daemon route at `POST /api/eval/run` to return a uniform `200`
    with a discriminated body (`{ ok: true; fixtureCount; repeatCount;
    passAtK; passHatK; runArtifactBaseDir }` on success, `{ ok: false;
    reason: "no_fixtures"; message }` for the empty-fixtures case, or
    `{ ok: false; reason: "fixture_provenance"; message }` for
    request-validation and fixture-load failures), matching the skills
    migration precedent (`f62bbb65`'s "first multi-status-code → 200
    alignment for a typed mutation result"). The factory then calls
    `link.requestStrict<EvalRunResult>("POST", "/api/eval/run",
    options ?? {}, { timeoutMs: <long-eval timeout> })` with a
    timeout sized for unbounded eval runs (e.g.
    `Number.MAX_SAFE_INTEGER` to disable the 2s default, or a finite
    multi-hour cap — pin the choice in the test). If reshaping the
    daemon route is undesirable for parity reasons, the alternative is
    to call `link.fetchRaw("/api/eval/run", { method: "POST", body:
    JSON.stringify(options ?? {}), headers: { "Content-Type":
    "application/json" } })` and inspect `res.status` plus the parsed
    `body.error` message to discriminate between `200 → ok: true`,
    `400 + /no fixtures/i → no_fixtures`, and `400 → fixture_provenance`
    arms — only this method needs the raw escape-hatch, and the
    others stay on `requestStrict<T>`. Pick one approach and pin it
    in the wire-shape test; do not leave both paths in the tree.
  - `calibration(options)` → builds the same `URLSearchParams` shape
    today's `evalCalibrationHttp` builds (optional `windowDays`,
    `followUpDays`, `thresholdRate`, `minSample`, `runsDir`, omitted
    entirely when undefined) and calls
    `link.requestStrict<EvalCalibrationResult>("GET",
    `/eval/calibration${query}`)`. The query string is the empty
    string when no option keys produce a value, matching today's
    `params.toString() ? `?${params.toString()}` : ""` behavior.

  matching today's `evalListHttp` / `evalRunHttp` /
  `evalCalibrationHttp` URL paths, HTTP verbs, query-string
  contracts, and JSON-body contracts byte-for-byte (modulo the
  recommended reshape of the run response from `400 + { error }` to
  `200 + { ok: false; reason; message }`, which is a daemon-side
  concern pinned in the wire-shape test).
- `src/core/server/daemon-client.ts` no longer carries `evalListHttp`,
  `evalRunHttp`, `evalCalibrationHttp`, the inline
  `evalHarness: { list, run, calibration }` closure on the core-side
  stub builder, the `EvalCalibrationOptions` / `EvalCalibrationResult`
  / `EvalListResult` / `EvalRunOptions` / `EvalRunResult` imports
  from `./kota-client.js`, or any other eval-namespace-specific
  helpers. Module-contributed handlers replace all of these the same
  way every prior migration did.
- `src/modules/eval-harness/index.ts` updates its import of
  `EvalHarnessClient` from `#core/server/kota-client.js` to the
  module-local `./client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/eval-harness/daemon-client.test.ts`) exercises the
  wire shape against a recording `DaemonTransport`, mirroring
  `src/modules/history/daemon-client.test.ts`,
  `src/modules/knowledge/daemon-client.test.ts`,
  `src/modules/memory/daemon-client.test.ts`,
  `src/modules/secrets/daemon-client.test.ts`,
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/approval-queue/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `evalHarness`, (2) `list()` routes through `requestStrict<T>` with
  method `GET`, path `/eval/list`, and an undefined body, (3)
  `run(options)` routes through the chosen primitive (either
  `requestStrict<T>` if the daemon route is reshaped to the uniform
  `200` discriminated body, or `fetchRaw` if the `400-status`
  protocol is preserved) with method `POST`, path `/api/eval/run`,
  and the full options body (including a call with no options
  defaulting to `{}` and a call with every optional key set, plus
  the `timeoutMs` override pinned to whatever cap the migration
  picks if `requestStrict<T>` is used), exercising all three arms
  (`ok: true`, `no_fixtures`, `fixture_provenance`), (4)
  `calibration(options)` routes through `requestStrict<T>` with
  method `GET`, path `/eval/calibration?${params}`, and an undefined
  body — including one call with no options (no query string, just
  `/eval/calibration`), one call with `{ windowDays, followUpDays,
  thresholdRate, minSample, runsDir }` to pin the `URLSearchParams`
  insertion order matching today's `evalCalibrationHttp`, (5)
  `EvalRunResult` arms decode correctly: a `200` `{ ok: true;
  fixtureCount; repeatCount; passAtK; passHatK; runArtifactBaseDir }`
  response collapses unchanged, a `200` (or `400` if `fetchRaw`)
  `{ ok: false; reason: "no_fixtures"; message }` response collapses
  unchanged, and a `200` (or `400` if `fetchRaw`) `{ ok: false;
  reason: "fixture_provenance"; message }` response collapses
  unchanged, (6) `EvalCalibrationResult` decodes correctly through
  `requestStrict<T>` (the `aggregate` and `decision` `Record<string,
  unknown>` fields pass through unchanged), (7) `EvalListResult`
  decodes correctly through `requestStrict<T>` (the `fixtures` array
  passes through unchanged with all five `EvalFixtureSummary` keys
  preserved verbatim), (8) the assembly satisfies coverage with the
  evalHarness contribution, and (9) the assembly throws naming
  "evalHarness" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"evalHarness"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `evalHarness` handler returning `{ fixtures: [] }` from `list()`,
  `{ ok: false, reason: "no_fixtures", message: "stub" }` from
  `run()`, and `{ aggregate: {}, decision: {} }` from `calibration()`
  so tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.
- If the daemon route reshape is taken (the recommended path), the
  POST `/api/eval/run` handler in `src/modules/eval-harness/routes.ts`
  changes from emitting `400 + { error }` for the
  no-fixtures and fixture-load failure paths to emitting `200` with a
  discriminated body. The handler still emits `400` for malformed
  JSON request bodies (the path that is genuinely a client protocol
  error and not a typed eval failure), and the factory's
  `requestStrict<T>` path lets that throw the way it would for any
  other malformed daemon call. Pin the new daemon-side response
  shapes in `src/modules/eval-harness/routes.test.ts` (or the
  closest existing route-level test) so the protocol change is not
  silently broken by a future refactor.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes
  beyond the optional run-status reshape (`400 + { error }` to
  `200 + { ok: false; reason; message }` for typed eval failures)
  called out in `## Desired Outcome` above. The `/eval/list`,
  `/eval/calibration`, and `/api/eval/run` routes keep their HTTP
  verbs (GET / GET / POST), query-string contracts (`?windowDays=…&
  followUpDays=…&thresholdRate=…&minSample=…&runsDir=…` on
  calibration), and JSON-body contracts (the run options on POST,
  none on the GETs) exactly as parsed in
  `src/modules/eval-harness/routes.ts` and
  `src/modules/eval-harness/eval-control-routes.ts`. The CLI-facing
  `kota eval` subcommands (`list`, `run`, `calibration`), the cadence
  workflow, the regression-notify workflow, and the subprocess
  executor are unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` (and
  `link.fetchRaw` only if the migration picks the
  `400-status-preserved` alternative) through the typed
  `DaemonTransport`. It does not reach into `node:http`, the bearer
  token, or `.kota/daemon-control.json`. The HTTP method and path
  stay byte-for-byte identical to today's wire code, including the
  `URLSearchParams` insertion order on the calibration path so any
  future server-side query-key parser changes round-trip safely.
- The two-stem route layout (`/eval/list` and `/eval/calibration` for
  control-plane reads, `/api/eval/run` for the long-running run on
  the API server) is preserved. The `daemonClient` factory threads
  both stems through the same typed link. Do not rename the run
  route to `/eval/run` or the list/calibration routes to `/api/eval/*`
  — that would change the operator-facing daemon HTTP contract and
  is out of scope.
- The long-running POST contract is preserved exactly: today's run
  call has no client-side timeout, and the migration must preserve
  that. If the typed link path is taken, pass an explicit
  `timeoutMs` override (`Number.MAX_SAFE_INTEGER` or a finite
  multi-hour cap — pin in the wire-shape test). If `fetchRaw` is
  taken, the call is naturally untimed.
- The `aggregate` and `decision` `Record<string, unknown>`
  pass-through types stay imported from inside the module's
  `client.ts` declaration — they are not provider types nor
  cross-cutting types; they are an explicit contract decision to
  avoid coupling the operator-facing surface to autonomy-internal
  shapes. Move them as-is.
- No legacy or compatibility surface. Delete `evalListHttp`,
  `evalRunHttp`, `evalCalibrationHttp`, the inline closure, the
  central type declarations, and the `EvalCalibrationOptions` /
  `EvalCalibrationResult` / `EvalListResult` / `EvalRunOptions` /
  `EvalRunResult` imports at the migration's edges as it completes;
  do not leave shims. The in-module import shift in `index.ts` from
  `#core/server/kota-client.js` to `./client.js` is a hard cutover,
  not a parallel re-export.
- The `EvalRunResult` three-arm shape (`{ ok: true; ... } | { ok:
  false; reason: "no_fixtures"; message } | { ok: false; reason:
  "fixture_provenance"; message }`) is preserved exactly in the
  client contract regardless of the wire-status choice. The
  `EvalListResult` shape (`{ fixtures: EvalFixtureSummary[] }`) is
  preserved exactly. The `EvalCalibrationResult` shape (`{ aggregate:
  Record<string, unknown>; decision: Record<string, unknown> }`) is
  preserved exactly.
- The daemon-up branch's transport behavior preserves today's
  semantics: `list` and `calibration` propagate transport errors
  through `requestStrict<T>` (today's central closures already throw
  on non-`ok` responses with the JSON `error` body, matching
  `requestStrict<T>`'s contract). `run` returns the typed
  discriminated union end-to-end without throwing for the
  `no_fixtures` or `fixture_provenance` arms; only genuinely
  unexpected failures (network errors, malformed responses, unknown
  HTTP status) throw.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `EvalCalibrationOptions` / `EvalCalibrationResult` /
  `EvalListResult` / `EvalRunOptions` / `EvalRunResult` /
  `EvalFixtureSummary` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, modulesAdmin, agents, skills, mcpServer,
  web, capture, recall, webhook, approvals, secrets, memory,
  knowledge, and history migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change for the operator-facing CLI. CLI behavior
  (`kota eval list`, `kota eval run`, `kota eval calibration`),
  daemon-up vs daemon-down branching, and exit-code semantics all
  continue to behave identically. The internal route protocol change
  (if the reshape is taken) is invisible to the operator.
- Output continues to flow through `src/modules/rendering`. The
  eval-harness module's existing CLI rendering hooks are not part of
  this refactor.

## Done When

- `src/modules/eval-harness/client.ts` exists and declares
  `EvalHarnessClient`, `EvalFixtureSummary`, `EvalListResult`,
  `EvalRunOptions`, `EvalRunResult`, `EvalCalibrationOptions`, and
  `EvalCalibrationResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `EvalHarnessClient` from
  this module.
- `src/modules/eval-harness/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/eval-harness/index.ts` imports `EvalHarnessClient`
  from `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `evalHarness`-specific code: no `evalListHttp`, `evalRunHttp`,
  `evalCalibrationHttp`; no inline `evalHarness: { ... }` closure on
  the core-side stub builder; no `EvalCalibrationOptions` /
  `EvalCalibrationResult` / `EvalListResult` / `EvalRunOptions` /
  `EvalRunResult` imports; and no other eval-namespace-specific
  helpers.
- `src/modules/eval-harness/daemon-client.test.ts` exists and pins
  the invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET list, the POST
  run with the chosen wire-status protocol exercising all three
  result arms, the GET calibration with the multi-key URLSearchParams
  shape, per-arm `EvalRunResult` decoding, `EvalListResult`
  pass-through decoding, `EvalCalibrationResult` `Record<string,
  unknown>` pass-through decoding, coverage success when the
  contribution is supplied, and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"evalHarness"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `evalHarness` handler whose three methods return the placeholder
  shapes in `## Desired Outcome` above.
- If the daemon route reshape is taken, the POST `/api/eval/run`
  handler in `src/modules/eval-harness/routes.ts` emits the new
  `200 + { ok: true | false; reason?; message? }` discriminated body
  for typed eval failures, and a route-level test pins the new
  response shapes (the malformed-JSON `400` path is preserved as a
  protocol error, separate from the typed-failure protocol).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `EvalCalibrationOptions` / `EvalCalibrationResult` /
  `EvalListResult` / `EvalRunOptions` / `EvalRunResult` /
  `EvalFixtureSummary` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`evalharness-daemon-up.txt` / `evalharness-daemon-down.txt`)
  demonstrate parity for one read (`kota eval list`) and the typed
  failure arm (`kota eval run --fixture-id nonexistent` exercising
  the `fixture_provenance` arm via a deliberately-missing fixture
  id, with no daemon network call needed for the daemon-down side
  since the local handler validates the same way) showing the
  pre/post output is identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T03-41-15-291Z-explorer-x2bcpk/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twenty-two orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the history migration):

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
  side handler precedent.
- `f79a2ee5` — web migration generalizing the stub-only precedent.
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union.
- `5ab2bd0b` — recall migration extending the pattern to a five-arm
  `RecallHit` discriminated union including a nested four-arm
  `result` union on the answer arm.
- `201d35ce` — webhook migration extending the pattern to the DELETE
  verb plus `encodeURIComponent`-escaped workflow id path parameters.
- `e0030ada` — approvals migration extending the pattern to a
  query-string status discriminator threaded through `requestStrict<T>`,
  a two-arm mutation discriminated union keyed off the daemon's
  `404 → not_found` mapping, and a daemon-route default that anchors
  the daemon-up factory's omit-when-undefined behavior.
- `5841c7f0` — secrets migration extending the pattern to the PUT
  verb with a JSON body, a non-`not_found` mutation failure arm
  (`store_error` with optional message), and a DELETE-with-query-
  string request shape threaded through `encodeURIComponent`.
- `5bcc9e24` — memory migration extending the pattern with the first
  daemon-wire-to-client-contract shape transformation
  (`excerpt → content`, `tags` dropped, `limit` slicing) and the
  first `semantic_unavailable` discriminated-union arm wired through
  `requestStrict<T>`.
- `d346a5c7` — knowledge migration extending the pattern with the
  first multi-key URLSearchParams filter (six optional keys) wired
  through `requestStrict<T>` with a `semantic_unavailable` arm, the
  first namespace carrying both a `{ found: true | false }` show-arm
  and a `{ ok: false; reason: "not_found" }` delete-arm threaded
  through `request<T>`, and the first contract surfacing a provider
  type (`KnowledgeEntry`) verbatim from
  `#core/modules/provider-types.js` without a wire-shape
  transformation.
- `a38978c8` — history migration extending the pattern with the first
  two-stem route contract (`/history*` for list/show/delete/reindex
  plus `/api/history/search` for semantic search) threaded through
  the same factory, the first migration whose mutation path
  exercised an HTTP `204` success status (collapsed into the
  knowledge/approvals/secrets `200 + { deleted: id }` precedent),
  and the first migration whose contract surfaces a provider type
  (`ConversationData`) verbatim through the daemon route on a single
  arm of a discriminated union (the show arm).

`evalHarness` is the next-cleanest multi-method namespace with three
short HTTP wire calls (GET / POST / GET-with-query-string) covering
its complete daemon contract — the natural next pilot in the cluster
that began with the doctor, harnessParity, ownerQuestions, agents,
capture, approvals, memory, knowledge, and history migrations. It
extends the pattern in three axes the prior pilots did not exercise:
(a) the first migration whose mutation path issues a long-running
POST that today drops the central `fetchWithTimeout` wrapper entirely
because eval runs frequently exceed the 2s default timeout,
validating that either `DaemonRequestInit.timeoutMs` cleanly threads
through the typed `DaemonTransport` for a long-running operation or
that `link.fetchRaw` is the right escape-hatch for unbounded daemon
calls; (b) the first migration whose error contract uses regex-based
message discrimination (`/no fixtures/i.test(msg)` chooses
`no_fixtures` over `fixture_provenance` for `400 + { error }`
responses), forcing an explicit choice between reshaping the daemon
route to return `200 + { ok: false; reason; message }` (the skills
precedent) or threading the regex-on-message discriminator through
`link.fetchRaw`, with the chosen approach pinned in the wire-shape
test; and (c) the first migration whose contract exposes a
`Record<string, unknown>` pass-through result shape
(`EvalCalibrationResult.aggregate` and `EvalCalibrationResult.decision`
are plain JSON records to avoid coupling the contract to the
autonomy module's internal types), validating that
`requestStrict<T>` cleanly threads JSON pass-through types alongside
the discriminated-union results that prior pilots already exercised.
This migration de-risks the upcoming workflow namespace migration
that shares the long-running POST shape (`/workflow/trigger` can
queue agent runs that exceed the 2s default), the upcoming
daemonOps namespace migration that shares the daemon-side-only
contract pattern, and the upcoming voice namespace migration that
shares the binary-payload-with-`fetchRaw` shape. It is needed under
every chunking answer the owner can pick on the parent task
(a/b/c/d/unblock): the evalHarness namespace migrates exactly once
regardless of whether the parent lands in one cohesive run or fans
out across follow-ups, so this task does not commit the owner to
any specific chunking answer; it shrinks the parent task's scope
by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `evalHarnessModule`, the in-module import shift in `index.ts`, the
  removed `evalListHttp` / `evalRunHttp` / `evalCalibrationHttp`
  plus inline closure plus imports from
  `src/core/server/daemon-client.ts`, the optional daemon-side route
  reshape in `src/modules/eval-harness/routes.ts`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~80-line and ~62-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`evalharness-daemon-up.txt` / `evalharness-daemon-down.txt`)
  exercising one read (`kota eval list`) and the typed failure arm
  (`kota eval run --fixture-id nonexistent` exercising the
  `fixture_provenance` arm via a deliberately-missing fixture id)
  with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `EvalCalibrationOptions` / `EvalCalibrationResult` /
  `EvalListResult` / `EvalRunOptions` / `EvalRunResult` /
  `EvalFixtureSummary` declaration in `src/core/server/`.
