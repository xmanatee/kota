---
id: task-migrate-the-config-kotaclient-namespace-end-to-end
title: Migrate the config KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move ConfigClient, ConfigValidateResult, ConfigGetResult, ConfigSetResult from src/core/server/kota-client.ts into src/modules/config/client.ts; add a daemonClient(link) factory to src/modules/config/index.ts that contributes the config namespace handler routing GET /config/validate, GET /config/value, PUT /config/value, GET /config/schema-path, GET /config/schema through the typed DaemonTransport; remove the inline config closure plus the configValidateHttp/configGetHttp/configSetHttp/configSchemaPathHttp/configSchemaContentHttp helper functions from src/core/server/daemon-client.ts; extend STUB_OMITTED_NAMESPACES and buildMigratedNamespaceTestStubs() with the config stub.
created_at: 2026-05-05T06:18:30.901Z
updated_at: 2026-05-05T06:18:30.901Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03) and twenty-three follow-on
migrations (`harnessParity` `927dca24`, `audit` `b6278cf1`, `retract`
`8c212f0c`, `answer` `eb392cd1`, `ownerQuestions` `68b74850`, `modules`
`c143c892`, `modulesAdmin` `03485329`, `agents` `7965beb6`, `skills`
`f62bbb65`, `mcpServer` `10877651`, `web` `f79a2ee5`, `capture` `e0e9aa93`,
`recall` `5ab2bd0b`, `webhook` `201d35ce`, `approvals` `e0030ada`, `secrets`
`5841c7f0`, `memory` `5bcc9e24`, `knowledge` `d346a5c7`, `history`
`a38978c8`, `evalHarness` `d3afe7e7`, `voice` `24d0ebed`, `sessions`
`84a52d7e`, `daemonOps` `d0efe79c` 2026-05-05) have validated the
`daemonClient(link)` foundation pattern by moving twenty-four namespaces
out of `src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. Three namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 565 lines, `daemon-client.ts` is 964 lines, both
still over the 300-line guideline).

The next-cleanest namespace is `config`:

- 5 methods (`validate()`, `get(key)`, `set(key, rawValue)`, `schemaPath()`,
  `schemaContent()`) — owned by the `src/modules/config/` module, which
  already exposes a `localClient(ctx)` factory at
  `src/modules/config/index.ts:110-129` returning a complete
  `ConfigClient` backed by `validateConfig`, `getConfigValue`,
  `setConfigValue`, `configSchemaPath`, and `configSchemaContent` from
  `config-operations.ts`.
- The smallest remaining namespace by helper count and method count.
  Every method is a thin HTTP wrapper with no cross-method state, no
  per-method retry logic, and no SSE — the `validate`, `schemaPath`, and
  `schemaContent` methods are pure GETs returning a typed response;
  `get` is a GET that distinguishes 404 → `{ found: false, reason:
  "not_found" }` from a typed body; `set` is a PUT that throws on a
  non-ok HTTP body using the daemon's `error` field.
- ~65 lines of namespace-owned types in `kota-client.ts` (lines 408-472):
  - `ConfigValidateResult` (lines 419-423, 5 lines): the
    `{ sources: { label: "global" | "project"; path: string }[]; warnings:
    string[]; resolved: Record<string, unknown> }` shape.
  - `ConfigGetResult` (lines 434-436, 3 lines): the two-arm
    `{ found: true; value: unknown } | { found: false; reason:
    "not_found" }` discriminated union.
  - `ConfigSetResult` (lines 448-453, 6 lines): the
    `{ ok: true; unknownKey: boolean; topKey: string; value: unknown }`
    shape.
  - `ConfigClient` (lines 466-472, 7 lines).
  - The supporting doc comments (lines 408-417, 425-432, 437-447, 455-465).
- ~85 lines of namespace-only helper functions plus inline closure in
  `daemon-client.ts`:
  - `configValidateHttp` (lines 105-116, 12 lines): GET `/config/validate`,
    throws on non-ok with the daemon's `error` field.
  - `configGetHttp` (lines 118-132, 15 lines): GET
    `/config/value?key=<encodeURIComponent(key)>`, returns
    `{ found: false, reason: "not_found" }` on 404 and the typed body on
    success.
  - `configSetHttp` (lines 134-149, 16 lines): PUT `/config/value` with
    JSON body `{ key, rawValue }`, throws on non-ok.
  - `configSchemaPathHttp` (lines 151-162, 12 lines): GET
    `/config/schema-path`.
  - `configSchemaContentHttp` (lines 164-175, 12 lines): GET
    `/config/schema`.
  - The inline `config: { validate, get, set, schemaPath, schemaContent }`
    closure on `buildCoreStubDaemonClientHandlers` (lines 676-682, 7 lines).
  - The 4 type imports `ConfigGetResult`, `ConfigSetResult`,
    `ConfigValidateResult` (and the `ConfigClient` import is already
    indirect through `KotaClient`) at the top of `daemon-client.ts`.
- The 5 helper functions are consumed only by the inline `config` closure
  — there are no non-namespace direct methods on `DaemonControlClient`
  that wrap them. They can be deleted in this migration with no caller
  fallout (unlike `getDaemonStatusHttp`/`reloadConfigHttp`/`daemonManagedHttp`
  which `getDaemonStatus()`/`reloadConfig()` direct methods on the class
  consume; that asymmetry is `daemonOps`-specific and does not apply to
  config).
- The wire code today issues:
  - `validate()` → GET `/config/validate`. Response `200 + ConfigValidateResult`
    on success; `!ok` throws the daemon's `error` field as an `Error`
    message (or `HTTP <status>` when no error body is parseable).
  - `get(key)` → GET `/config/value?key=<encodeURIComponent(key)>`.
    Response `200 + ConfigGetResult` on success; `404` collapses to
    `{ found: false, reason: "not_found" }`; `!ok` throws the daemon's
    `error` field.
  - `set(key, rawValue)` → PUT `/config/value` with `Content-Type:
    application/json` and JSON body `{ key, rawValue }`. Response
    `200 + ConfigSetResult` on success; `!ok` throws the daemon's
    `error` field.
  - `schemaPath()` → GET `/config/schema-path`. Response `200 +
    { path: string }`; `!ok` throws.
  - `schemaContent()` → GET `/config/schema`. Response `200 +
    { content: string }`; `!ok` throws.
- The `src/modules/config/index.ts` module already imports
  `ConfigClient` from `#core/server/kota-client.js` (line 11). After the
  migration, the new `client.ts` declares the types alongside the local
  factory; `index.ts` imports `ConfigClient` from `./client.js` instead,
  same as `daemon-ops/index.ts` imports `DaemonOpsClient` from
  `./client.js`.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
single-module shape as the prior pilots. No new pattern dimensions
relative to the `daemonOps` migration: `config` does not have the
"daemon-side method that throws by construction" arm, does not have two
methods sharing one route, and is the first migration of its scope to
prove the prior pattern transfers cleanly to a multi-method namespace
with one-route-per-method coverage. The 404-returning `get` arm shape
matches the `ownerQuestions.answer` / `webhook.secretRemove` /
`approvals.approve` / `sessions.setAutonomyMode` / `secrets.get`
patterns already validated.

## Desired Outcome

`config` is the twenty-fifth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `ConfigClient`, `ConfigValidateResult`, `ConfigGetResult`,
  `ConfigSetResult` live in `src/modules/config/client.ts`. The
  aggregate `KotaClient` interface in
  `src/core/server/kota-client.ts` imports `ConfigClient` from
  `#modules/config/client.js` instead of declaring the types inline.
  The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/config/index.ts` adds a
  `daemonClient: (link) => ({ config: buildConfigDaemonHandler(link) })`
  field on the `KotaModule` definition. The new
  `buildConfigDaemonHandler(link): ConfigClient` factory returns the
  five-method namespace handler whose methods route through:
  - `validate()` → calls `link.request<ConfigValidateResult>("GET",
    "/config/validate")`. On `null` (transport failure or non-ok
    response) throws `"Daemon unreachable while validating config"`.
    On success returns the typed body verbatim.
  - `get(key)` → calls `link.fetchRaw("/config/value?key=<encodeURIComponent(key)>",
    { method: "GET" })`. On `404` returns `{ found: false, reason:
    "not_found" }`. On `!ok` reads the body's `error` field and throws
    (matching today's `HTTP <status>` fallback). On success parses the
    typed `ConfigGetResult` body and returns it. Use `link.fetchRaw`
    not `link.request<T>` because the 404 → `{ found: false }` arm
    must be distinguished from generic transport failure (which
    `link.request<T>` collapses into `null`); this is the same
    fetchRaw-with-status-discrimination pattern the prior 404-emitting
    namespaces use.
  - `set(key, rawValue)` → calls `link.fetchRaw("/config/value",
    { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, rawValue }) })`. On `!ok` reads the
    body's `error` field and throws. On success parses the typed
    `ConfigSetResult` body and returns it. The `Authorization` header
    is added automatically by the typed link, matching the prior
    fetchRaw pattern.
  - `schemaPath()` → calls `link.request<{ path: string }>("GET",
    "/config/schema-path")`. On `null` throws `"Daemon unreachable
    while reading config schema path"`. On success returns the typed
    body verbatim.
  - `schemaContent()` → calls `link.request<{ content: string }>("GET",
    "/config/schema")`. On `null` throws `"Daemon unreachable while
    reading config schema content"`. On success returns the typed
    body verbatim.

  matching today's `configValidateHttp` / `configGetHttp` /
  `configSetHttp` / `configSchemaPathHttp` / `configSchemaContentHttp`
  URL paths, HTTP verbs, JSON-body contracts, and reshape mappings
  byte-for-byte. The control-route stems (`/config/validate`,
  `/config/value`, `/config/schema-path`, `/config/schema`) are
  preserved.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `config: { validate, get, set, schemaPath, schemaContent }` closure
  on `buildCoreStubDaemonClientHandlers`, no longer carries the five
  helper functions `configValidateHttp`, `configGetHttp`,
  `configSetHttp`, `configSchemaPathHttp`, `configSchemaContentHttp`,
  and no longer imports `ConfigGetResult`, `ConfigSetResult`, or
  `ConfigValidateResult` from `./kota-client.js`. The
  `DaemonControlClient` class has no public method that wraps these
  helpers (unlike `getDaemonStatus`/`reloadConfig` for daemon-ops), so
  the deletion is total — there is no non-namespace caller fallout to
  manage.
- `src/modules/config/index.ts` imports `ConfigClient` from
  `./client.js` instead of from `#core/server/kota-client.js`. The
  `localClient` factory continues to compose
  `{ config: <ConfigClient impl> }` unchanged (the local handler
  implementation does not move).
- A new daemon-side factory unit test alongside the module
  (`src/modules/config/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/daemon-ops/daemon-ops-daemon-client.test.ts`,
  `src/modules/daemon-ops/sessions-daemon-client.test.ts`, and the
  prior multi-method pilots. The test pins (1) the factory
  contributes `config` with `validate`, `get`, `set`, `schemaPath`,
  `schemaContent`, (2) `validate()` routes through `request("GET",
  "/config/validate")` and decodes the success arm correctly: a
  `200 + { sources: [{ label: "project", path: "/p/.kota/config.json" }],
  warnings: [], resolved: { foo: 1 } }` response collapses to the same
  body verbatim, (3) `validate()` throws on `null` (transport failure
  or non-ok response) with message containing `"Daemon unreachable"`,
  (4) `get(key)` routes through `fetchRaw` with method `GET`, path
  `/config/value?key=<encodeURIComponent(key)>` (encoding pinned
  byte-for-byte, e.g. `kota.x.y` → `kota.x.y`, `weird key` →
  `weird%20key`), (5) `get(key)` decodes the success arm correctly: a
  `200 + { found: true, value: <value> }` response collapses to
  `{ found: true, value: <value> }`, (6) `get(key)` decodes the
  not_found arm correctly: a `404` response collapses to
  `{ found: false, reason: "not_found" }`, (7) `set(key, rawValue)`
  routes through `fetchRaw` with method `PUT`, path
  `/config/value`, headers `{ "Content-Type": "application/json", ...
  link.authHeaders() }`, and body `{ key, rawValue }` pinned
  byte-for-byte, (8) `set` decodes the success arm correctly: a
  `200 + { ok: true, unknownKey: false, topKey: "kota", value: 5 }`
  response collapses to the same body verbatim, (9) `set` throws on
  a `400 + { error: "invalid value" }` response with message
  containing `"invalid value"`, (10) `schemaPath()` routes through
  `request("GET", "/config/schema-path")` and decodes the success
  arm correctly: a `200 + { path: "/p/.kota/schema.json" }`
  response collapses verbatim; throws on `null` with
  `"Daemon unreachable"`, (11) `schemaContent()` routes through
  `request("GET", "/config/schema")` and decodes the success arm
  correctly: a `200 + { content: "<json>" }` response collapses
  verbatim; throws on `null` with `"Daemon unreachable"`,
  (12) the assembly satisfies coverage with the config contribution,
  and (13) the assembly throws naming `"config"` when the contribution
  is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"config"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `config` handler whose five methods return placeholder shapes
  (`validate()` → `{ sources: [], warnings: [], resolved: {} }`,
  `get()` → `{ found: false, reason: "not_found" }`, `set()` →
  `{ ok: true, unknownKey: false, topKey: "stub", value: null }`,
  `schemaPath()` → `{ path: "" }`, `schemaContent()` → `{ content: "" }`)
  so tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.
- The config module's `AGENTS.md` is updated to describe the new
  `buildConfigDaemonHandler` factory as the daemon-side surface the
  module contributes through `daemonClient(link)`. Any prior
  description of the central `config: {...}` closure on
  `buildCoreStubDaemonClientHandlers` is removed.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes. The
  `/config/validate`, `/config/value` (GET and PUT), `/config/schema-path`,
  and `/config/schema` routes keep their HTTP verbs, JSON-body contracts,
  and response shapes exactly as parsed in
  `src/modules/config/config-control-routes.ts`. The CLI-facing `kota
  config` subcommands (`validate`, `get`, `set`, `schema`) and the
  module's `config-operations.ts` formatting are unrelated to this
  migration and must not be touched.
- The daemon-side handler uses `link.request` and `link.fetchRaw` through
  the typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json` directly.
- Both the inline `config` closure and all five `config*Http` helper
  functions are deleted from `src/core/server/daemon-client.ts`. The
  `DaemonControlClient` class has no public method wrapping them, so
  there is no non-namespace caller fallout — unlike the `daemonOps`
  migration which had to leave `getDaemonStatusHttp`/`reloadConfigHttp`/
  `daemonManagedHttp` in place. Confirm the absence of remaining
  `import { config*Http }` callers in the same change.
- The `STUB_OMITTED_NAMESPACES` and `buildMigratedNamespaceTestStubs`
  pattern is the established way to keep `daemon-client.test.ts` green
  for tests that build a `DaemonControlClient` without going through
  full module wiring — extend, do not bypass.
- No legacy or compatibility surface. Delete the old centralized type
  declarations, helper functions, and namespace handler closure as the
  migration completes; do not leave deprecation shims.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` are green. The new
  daemon-side factory test asserts wire-shape parity with the prior
  inline closure.
- Daemon-up and daemon-down CLI transcripts demonstrate parity for
  `kota config validate`, `kota config get <key>`,
  `kota config set <key> <value>`, `kota config schema`, and `kota
  config schema --print` against the pre-migration behavior.

## Done When

- `ConfigClient`, `ConfigValidateResult`, `ConfigGetResult`,
  `ConfigSetResult` are declared in `src/modules/config/client.ts` and
  removed from `src/core/server/kota-client.ts`. The `KotaClient`
  aggregate imports `ConfigClient` from `#modules/config/client.js`.
- `src/modules/config/index.ts` adds a
  `buildConfigDaemonHandler(link): ConfigClient` factory and exports
  a `daemonClient: (link) => ({ config: buildConfigDaemonHandler(link) })`
  field on the `KotaModule` definition.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `config: { validate, get, set, schemaPath, schemaContent }` closure
  on `buildCoreStubDaemonClientHandlers`, no longer carries the
  five helpers `configValidateHttp`, `configGetHttp`, `configSetHttp`,
  `configSchemaPathHttp`, `configSchemaContentHttp`, and no longer
  imports `ConfigGetResult`/`ConfigSetResult`/`ConfigValidateResult`
  from `./kota-client.js`.
- `STUB_OMITTED_NAMESPACES` in `daemon-client.test.ts` includes
  `"config"`. `buildMigratedNamespaceTestStubs()` in
  `daemon-client-test-stubs.ts` provides a stub `config` handler.
- A new `src/modules/config/daemon-client.test.ts` exercises the wire
  shape end-to-end (13 cases as enumerated in `## Desired Outcome`).
- The config module's `AGENTS.md` reflects the
  `buildConfigDaemonHandler` daemon-side factory as the module's
  daemon-side surface for the `config` namespace.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts under the run directory
  show `kota config validate`, `kota config get <key>`,
  `kota config set <key> <value>`, `kota config schema`, and
  `kota config schema --print` produce the same operator output as
  before the migration.
- `src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
  shrink by the config namespace's share of lines (~65 lines in
  `kota-client.ts`, ~85 lines in `daemon-client.ts`). Neither file
  needs to be under the 300-line guideline at this task's completion
  — the remaining 2 namespaces (`workflow`, `tasks`) carry the bulk
  of the residual line count and migrate in their own follow-up tasks.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T06-16-12-425Z-explorer-s4ms4k/` after the
daemonOps migration landed at commit `d0efe79c` ("migrate daemonOps
KotaClient namespace through daemonClient(link) hook", 2026-05-05).
The just-landed daemonOps migration's `## Initiative` section names
the three remaining namespaces ("3 namespaces remain centralized:
`workflow`, `tasks`, `config`; each will land in its own
per-namespace migration task"). `config` is selected as the next
follow-up because it is the smallest of the three (5 methods, all
thin HTTP wrappers, owning module already exists with `localClient`
wired) and exercises only the already-validated patterns —
`workflow` (~14 methods, complex run-status reshape with
`pendingAbort: false` synthesis) and `tasks` (8 methods including the
`/api/tasks` aggregate-list endpoint with state filtering) carry
larger scopes that benefit from landing after the `config` precedent
confirms the multi-route GET-plus-PUT-plus-404 pattern transfers
cleanly.

The parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` remains
blocked on the `kotaclient-namespace-distribution-chunking` owner
decision; per-namespace migration tasks (proposed answer (b)) have
been the de-facto execution path since 2026-05-03 and have moved
24 of 27 namespaces out of `src/core/server/`. This task continues
that cadence on the same orthogonal scope the parent task's
`## Decomposition Proposal` already named ("per-namespace
follow-ups"); landing it does not commit the owner to any specific
chunking answer.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives. After this migration, 2 namespaces remain
centralized (`workflow`, `tasks`); each will land in its own
per-namespace migration task.

## Acceptance Evidence

- Diff covering the type moves out of `src/core/server/kota-client.ts`
  into `src/modules/config/client.ts`, the `buildConfigDaemonHandler`
  factory and the `daemonClient(link)` export in
  `src/modules/config/index.ts`, the `config` closure plus five
  helper-function deletions from `src/core/server/daemon-client.ts`,
  the `STUB_OMITTED_NAMESPACES` and `buildMigratedNamespaceTestStubs()`
  extensions, the new daemon-side factory test, and the config
  `AGENTS.md` update.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after the migration
  showing the config share removed (~65 lines and ~85 lines
  respectively).
- New daemon-side factory test
  `src/modules/config/daemon-client.test.ts` passing, with the 13
  enumerated cases exercising request shapes, success-body decoding,
  the 404 → `{ found: false, reason: "not_found" }` arm on `get`, the
  `400 + { error }` throw arm on `set`, and the `null` →
  `"Daemon unreachable"` throw arms on `validate`, `schemaPath`, and
  `schemaContent`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  showing `kota config validate`, `kota config get <key>`,
  `kota config set <key> <value>`, `kota config schema`, and
  `kota config schema --print` produce the same operator output as
  before the migration.
