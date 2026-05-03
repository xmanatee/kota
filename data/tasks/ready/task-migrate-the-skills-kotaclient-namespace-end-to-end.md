---
id: task-migrate-the-skills-kotaclient-namespace-end-to-end
title: Migrate the skills KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move SkillsClient interface, SkillSummary, SkillsListResult, SkillImportOptions, and SkillImportResult from src/core/server/kota-client.ts into src/modules/skill-ops/client.ts; add a daemonClient(link) factory on skillsModule contributing the skills namespace backed by the typed DaemonTransport with one GET and one POST; align skills/import route to 200 for both ok and not-ok arms; remove listSkillsHttp, importSkillHttp, and the inline skills closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T11:58:16.352Z
updated_at: 2026-05-03T11:58:16.352Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), and the agents
migration (`7965beb6`, 2026-05-03) have validated the
`daemonClient(link)` foundation pattern by moving nine namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 18 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 1486 lines, `daemon-client.ts` is 1924 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`skills`:

- 2 methods (`list()`, `import(source, options?)`) — owned by the
  `skill-ops` module which already exposes a `localClient(ctx)` factory
  but not yet a `daemonClient(link)` factory. Adding the factory
  contributes a mixed read+mutation namespace whose mutation arm carries
  a discriminated `{ ok: false; reason: "fetch_failed" | "missing_name" }`
  failure result that the daemon route currently returns under HTTP 400
  / 502 — establishing the multi-status-code → 200 alignment precedent
  the agents migration set for the single-status-code → 200 case.
- ~50 lines of namespace-owned types in `kota-client.ts` (lines
  988–1036):
  - `SkillSummary` (lines 988–999, ~12 lines): the per-skill summary
    (name, source, optional description, promptPath, optional roles).
  - `SkillsListResult` (lines 1001–1003, 3 lines): the `{ skills:
    SkillSummary[] }` envelope.
  - `SkillImportOptions` (lines 1005–1008, 4 lines): the optional
    `{ name }` override for skill installation.
  - `SkillImportResult` (lines 1010–1024, ~15 lines): the discriminated
    `{ ok: true; name; path } | { ok: false; reason; message }`
    envelope.
  - `SkillsClient` interface (lines 1026–1036, ~11 lines).
- ~35 lines of wire code in `daemon-client.ts`:
  - `listSkillsHttp` (lines 481–492, 12 lines): GET `/skills` with
    bearer headers; non-2xx throws with the body's error message,
    success returns the JSON `SkillsListResult` verbatim.
  - `importSkillHttp` (lines 494–516, 23 lines): POST `/skills/import`
    with `{ source, name? }` body. The current implementation
    special-cases `400` and `502` to decode the body as
    `SkillImportResult` and return it; other non-2xx throws.
  - The inline `skills: { list, import }` closure on the central
    handler builder (lines 1514–1517, 4 lines).
- 3 imports in `daemon-client.ts` (`SkillImportOptions`,
  `SkillImportResult`, `SkillsListResult` from `./kota-client.js`) that
  go away with the wire functions.

The migration extends the foundation pattern in one axis the prior
nine pilots did not exercise:

1. **Multi-status-code → 200 alignment for a typed mutation result.**
   The agents pilot validated the single-status-code alignment
   (`/agents/:name`'s `404 → { found: false }` shape collapsed to a
   `200 { found: false }` strict-transport response). `skills.import`
   carries the symmetric multi-status case: today the daemon route
   emits `502 SkillImportResult` for `fetch_failed` and `400
   SkillImportResult` for `missing_name`, and the wire helper
   special-cases both statuses to decode the typed body. This task
   collapses both into `200 SkillImportResult`, matching the
   strict-transport posture every other migrated namespace's mutation
   uses (doctor.fix, harnessParity.run, retract.retract, answer.answer,
   ownerQuestions.answer/dismiss, modulesAdmin.reload all return 200
   regardless of the typed result's `ok` flag). The factory body then
   collapses to one `link.requestStrict<T>` call per method.

`SkillSummary`, `SkillsListResult`, `SkillImportOptions`,
`SkillImportResult`, and `SkillsClient` are also imported by:

- `src/modules/skill-ops/index.ts`: imports `SkillSummary`,
  `SkillsClient` from `#core/server/kota-client.js` today.
- `src/modules/skill-ops/skill-ops-operations.ts`: imports
  `SkillImportOptions`, `SkillImportResult`, `SkillSummary`,
  `SkillsListResult` from `#core/server/kota-client.js` today.

Both shifts are in-module imports from `./client.js` after the
migration. Neither file gains a `#modules/*` cross-module import; both
already live inside `skill-ops/`.

## Desired Outcome

`skills` is the tenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `SkillsClient`, `SkillSummary`, `SkillsListResult`,
  `SkillImportOptions`, and `SkillImportResult` live in
  `src/modules/skill-ops/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports `SkillsClient`
  from the module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/skill-ops/index.ts` adds a `daemonClient(link)` factory
  contributing the `skills` namespace. The factory returns `{ skills }`
  backed by `link.requestStrict<T>` calls:
  - `list()` → `link.requestStrict<SkillsListResult>("GET", "/skills")`.
  - `import(source, options)` →
    `link.requestStrict<SkillImportResult>("POST", "/skills/import",
    { source, ...(options?.name !== undefined && { name: options.name }) })`.
    The factory does **not** preserve today's special-cased `400 / 502
    → SkillImportResult` translation as a divergent code path —
    instead it issues the strict POST and decodes the canonical
    `SkillImportResult` discriminated union the daemon emits. Because
    the daemon route is the source of truth for the
    `{ ok: true | false }` envelope, the wire shape is uniform and the
    factory body collapses to one `link.requestStrict<T>` call.
    The existing daemon route at
    `src/modules/skill-ops/routes.ts:handleImport` currently emits
    `400 SkillImportResult` for `missing_name` and `502
    SkillImportResult` for `fetch_failed`; this task amends that
    handler to emit `200 SkillImportResult` for both not-ok arms to
    match the rest of the migrated namespaces' strict-transport
    posture and remove the `4xx/5xx → typed result` special-case.
    The malformed-body branch (today's `400 { error: "Invalid request
    body" }` and `400 { error: "source is required" }`) stays at 400
    with a thrown error, since those are protocol violations rather
    than typed result arms.
- `src/core/server/daemon-client.ts` no longer carries
  `listSkillsHttp`, `importSkillHttp`, the inline
  `skills: { list, import }` closure on the core-side stub
  builder, or the `SkillImportOptions` / `SkillImportResult` /
  `SkillsListResult` imports from `./kota-client.js`.
- `src/modules/skill-ops/skill-ops-operations.ts` imports
  `SkillImportOptions`, `SkillImportResult`, `SkillSummary`,
  `SkillsListResult` from `./client.js` instead of
  `#core/server/kota-client.js`.
- `src/modules/skill-ops/index.ts` imports `SkillSummary`,
  `SkillsClient` from `./client.js` instead of
  `#core/server/kota-client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/skill-ops/daemon-client.test.ts`, mirroring the
  existing `src/modules/agent-ops/daemon-client.test.ts`) exercises the
  wire shape against a mock `DaemonTransport`. The test pins (1) the
  factory contributes `skills`, (2) `list` routes through
  `requestStrict<T>` with `GET /skills` and no body, (3) a successful
  `{ skills: SkillSummary[] }` response decodes verbatim, (4) `import`
  routes through `requestStrict<T>` with `POST /skills/import` and the
  expected JSON body shape (with and without the optional `name`
  override), (5) a successful `{ ok: true; name; path }` response
  decodes verbatim, (6) a `{ ok: false; reason: "fetch_failed";
  message }` response decodes verbatim, (7) a `{ ok: false; reason:
  "missing_name"; message }` response decodes verbatim, (8)
  `requestStrict<T>` failures on either method propagate rather than
  being silently swallowed, (9) coverage success when the contribution
  is supplied and coverage failure when it is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"skills"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `skills` handler returning `{ skills: [] }` for `list` and
  `{ ok: true; name: "stub"; path: "stub" }` for `import` so tests
  that build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. The one acceptable shape adjustment is
  converting `/skills/import`'s current `400 SkillImportResult` /
  `502 SkillImportResult` not-ok branches to `200 SkillImportResult`
  to align with the strict-transport posture every other migrated
  namespace uses. No other route, wire shape, or response-body change.
  The malformed-body 400 branches stay 400 (those are protocol
  violations, not typed result arms).
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`.
- Strict error handling. Today's `listSkillsHttp` and `importSkillHttp`
  already throw on un-special-cased non-2xx; the migration preserves
  that posture through `requestStrict<T>` for the still-throwing
  branches and folds the special-cased typed-body branches into a
  single uniform 200-decode path.
- No legacy or compatibility surface. Delete `listSkillsHttp`,
  `importSkillHttp`, the inline closure, the central type
  declarations, and the `SkillImportOptions` / `SkillImportResult` /
  `SkillsListResult` imports at the migration's edges as it completes;
  do not leave shims. The in-module import shifts from
  `#core/server/kota-client.js` to `./client.js` are hard cutovers, not
  parallel re-exports.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `SkillSummary` / `SkillsListResult` /
  `SkillImportOptions` / `SkillImportResult` declarations in
  `src/core/server/`. Existing assertions for the doctor,
  harnessParity, audit, retract, answer, ownerQuestions, modules,
  modulesAdmin, and agents migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota skill list`, `kota skill
  import <source> [--name <name>]`), daemon-up vs daemon-down
  branching, and `--json` output all continue to behave identically
  modulo the optional 4xx/5xx→200 alignment above (which the CLI
  propagates through the same discriminated `{ ok: false }` branch
  either way).
- Output continues to flow through `src/modules/rendering`. The
  skill-ops module's existing CLI rendering (`buildSkillListLines`)
  is not part of this refactor.

## Done When

- `src/modules/skill-ops/client.ts` declares `SkillsClient`,
  `SkillSummary`, `SkillsListResult`, `SkillImportOptions`, and
  `SkillImportResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `SkillsClient` from this
  module.
- `src/modules/skill-ops/index.ts` adds a `daemonClient(link)` factory
  contributing the `skills` namespace, returning `{ skills }`. Both
  methods' factory bodies use the typed `DaemonTransport`; neither
  reaches into `node:http`, the bearer token, or
  `.kota/daemon-control.json`.
- `src/modules/skill-ops/index.ts` and
  `src/modules/skill-ops/skill-ops-operations.ts` import
  `SkillImportOptions`, `SkillImportResult`, `SkillSummary`,
  `SkillsListResult`, `SkillsClient` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/modules/skill-ops/routes.ts:handleImport` returns
  `200 SkillImportResult` for both `fetch_failed` and `missing_name`
  not-ok arms (replacing today's `502` and `400`), aligning with the
  strict-transport posture every other migrated namespace uses. The
  malformed-request `400 { error: "Invalid request body" }` and
  `400 { error: "source is required" }` branches stay at 400.
- `src/core/server/daemon-client.ts` no longer carries any
  skills-specific code: no `listSkillsHttp`, no `importSkillHttp`, no
  inline `skills: { list, import }` closure on the core-side stub
  builder, and no `SkillImportOptions` / `SkillImportResult` /
  `SkillsListResult` imports from `./kota-client.js`.
- `src/modules/skill-ops/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, two wire shapes, decoded success/not-ok shapes,
  transport-error propagation, coverage success when contribution is
  supplied and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"skills"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `skills` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `SkillSummary` /
  `SkillsListResult` / `SkillImportOptions` / `SkillImportResult`
  declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`skills-daemon-up.txt` / `skills-daemon-down.txt`) demonstrate
  parity for `kota skill list` and `kota skill import <source>`
  showing the pre/post output is identical across modes (including
  one fetch-failure case to exercise the not-ok arm).

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T11-53-48-270Z-explorer-nfnvb2/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Eleven orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all
  chunking answers).
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
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id.
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

`skills` is the natural next pilot. It is the smallest unmigrated
namespace owned by a single-purpose module that already has a
`localClient(ctx)` factory but not yet a `daemonClient(link)` factory,
and it is the first migration that exercises the "multi-status-code →
200 alignment" shape — the daemon route currently returns typed
`SkillImportResult` bodies under both `502` (fetch_failed) and `400`
(missing_name). Validating the pattern collapses cleanly for that
shape establishes the precedent for the remaining mutation-bearing
namespaces (`webhook.secretGenerate`/`secretRemove`,
`evalHarness.run`/`calibration`, `voice.transcribe`/`synthesize`,
several `config` mutations) that today still rely on bespoke status-
code decoders. The migration is needed under every chunking answer
the owner can pick (a/b/c/d/unblock): the skills namespace migrates
exactly once regardless of whether the parent lands in one cohesive
run or fans out across follow-ups, so this task does not commit the
owner to any specific chunking answer; it shrinks the parent task's
scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  new `daemonClient` factory on `skillsModule`, the in-module import
  shifts in `index.ts` and `skill-ops-operations.ts`, the `routes.ts`
  4xx/5xx→200 alignment for `handleImport`, the removed
  `listSkillsHttp` / `importSkillHttp` / inline closure, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~50-line and ~35-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`skills-daemon-up.txt` / `skills-daemon-down.txt`) exercising
  `kota skill list` and `kota skill import <source>` (success and
  fetch-failure cases) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `SkillSummary` /
  `SkillsListResult` / `SkillImportOptions` / `SkillImportResult`
  declaration in `src/core/server/`.
