---
id: task-migrate-the-secrets-kotaclient-namespace-end-to-en
title: Migrate the secrets KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move SecretsClient interface and the SecretListEntry/SecretListResult/SecretScope/SecretGetResult/SecretMutateResult types from src/core/server/kota-client.ts into src/modules/secrets/client.ts; add a daemonClient(link) factory to the secrets module that wires GET /api/secrets, GET/PUT/DELETE /api/secrets/:name through the typed DaemonTransport; remove listSecretsHttp/getSecretHttp/setSecretHttp/removeSecretHttp and the inline secrets handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-05T01:18:24.329Z
updated_at: 2026-05-05T01:18:24.329Z
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
webhook migration (`201d35ce`), and the approvals migration
(`e0030ada`, 2026-05-05) have validated the `daemonClient(link)`
foundation pattern by moving sixteen namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 11 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 1039 lines, `daemon-client.ts` is 1740 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `secrets`:

- 4 methods (`list()`, `get(name)`, `set(name, value, scope)`,
  `remove(name, scope)`) — one above the recent ~3-method pilots and
  the same shape as the operator-utility namespaces already migrated.
- Already owned by a dedicated module under `src/modules/secrets/` with
  its own `localClient(ctx)` factory (`index.ts`), control routes
  (`secretsRoutes()` registered against the daemon at `/api/secrets`,
  `/api/secrets/:name` GET/PUT/DELETE in `routes.ts`), and CLI
  (`commands` factory in `index.ts`).
- ~30 lines of namespace-owned types in `kota-client.ts` (lines
  62–90):
  - `SecretListEntry` (lines 63–66, 4 lines): the masked `{ name,
    source }` per-secret shape.
  - `SecretListResult` (lines 68–70, 3 lines): the `{ secrets }`
    aggregate result.
  - `SecretScope` (line 73): the `"project" | "global"` writable-scope
    discriminator.
  - `SecretGetResult` (line 76): the two-arm `{ found: true; value } |
    { found: false }` discriminated union.
  - `SecretMutateResult` (lines 79–81, 3 lines): the two-arm
    `{ ok: true } | { ok: false; reason: "not_found" | "store_error";
    message? }` discriminated union with the optional `message`
    diagnostic.
  - `SecretsClient` (lines 562–567, 6 lines).
  - The supporting doc comments (lines 62, 72, 75, 78, 553–561).
- ~75 lines of wire code in `daemon-client.ts` —
  `listSecretsHttp` (lines 708–720, 13 lines),
  `getSecretHttp` (lines 722–741, 20 lines),
  `setSecretHttp` (lines 743–764, 22 lines), and
  `removeSecretHttp` (lines 766–783, 18 lines) plus the inline
  `secrets: { list, get, set, remove }` closure on the central
  handler builder (lines 1270–1278, 9 lines).
- The wire code today issues GET `/api/secrets`, GET
  `/api/secrets/:name`, PUT `/api/secrets/:name`, and DELETE
  `/api/secrets/:name?scope=...` through `fetchWithTimeout` plus
  `transport.authHeaders()` directly; the factory body collapses into
  four strict requests once the typed `DaemonTransport` link supplies
  the standard JSON-decode path.
- The secrets module's local consumer (`index.ts`) currently imports
  `SecretsClient` from `#core/server/kota-client.js`. After the
  migration this import points at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in three new
dimensions: (a) the first migration to surface the **PUT verb** with a
JSON body (the prior writes were POST or DELETE), validating that
`link.requestStrict<T>` threads PUT method/body through unchanged,
(b) the first migration whose mutation result carries a non-`not_found`
failure arm (`{ ok: false; reason: "store_error"; message?: string }`)
exercising the `transport_error → 500-class fallback` mapping rather
than only the `null`-on-404 → `not_found` mapping that prior pilots
covered, and (c) the first migration with a **DELETE-with-query-string**
request shape (`?scope=project|global`) wired through the typed link,
exercising the path+query composition for a DELETE verb.

## Desired Outcome

`secrets` is the seventeenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `SecretsClient`, `SecretListEntry`, `SecretListResult`,
  `SecretScope`, `SecretGetResult`, and `SecretMutateResult` live in
  `src/modules/secrets/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `SecretsClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/secrets/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ secrets: SecretsClient }` whose four methods route
  through:
  - `list()` →
    `link.requestStrict<SecretListResult>("GET", "/api/secrets")`
  - `get(name)` →
    `link.request<{ found: true; value: string }>("GET", `/api/secrets/${encodeURIComponent(name)}`)`
    then collapsing `null` into `{ found: false }` and a non-null
    result into `{ found: true, value: result.value }`.
  - `set(name, value, scope)` → `link.requestStrict<{ ok: true }>("PUT",
    `/api/secrets/${encodeURIComponent(name)}`, { value, scope })`
    wrapped in a try/catch that maps thrown transport errors to
    `{ ok: false, reason: "store_error", message }`.
  - `remove(name, scope)` →
    `link.request<{ ok: true }>("DELETE",
    `/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`)`
    then collapsing `null` into `{ ok: false, reason: "not_found" }`
    and a non-null result into `{ ok: true }`, wrapped in a try/catch
    that maps thrown transport errors to `{ ok: false, reason:
    "store_error", message }`.

  matching today's `listSecretsHttp` / `getSecretHttp` /
  `setSecretHttp` / `removeSecretHttp` URL paths, HTTP verbs, and
  query-string contracts byte-for-byte.
- `src/core/server/daemon-client.ts` no longer carries
  `listSecretsHttp`, `getSecretHttp`, `setSecretHttp`,
  `removeSecretHttp`, the inline `secrets: { list, get, set, remove }`
  closure on the core-side stub builder, the `SecretGetResult` /
  `SecretMutateResult` / `SecretScope` imports from `./kota-client.js`,
  or any other secrets-namespace-specific helpers. Module-contributed
  handlers replace all of these the same way every prior migration
  did.
- `src/modules/secrets/index.ts` updates its import of `SecretsClient`
  from `#core/server/kota-client.js` to the module-local `./client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/secrets/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/approval-queue/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `secrets`, (2) `list()` routes through `requestStrict<T>` with
  method `GET`, path `/api/secrets`, and an undefined body,
  (3) `get(name)` routes through `request<T>` with method `GET`,
  path `/api/secrets/${encodeURIComponent(name)}`, and an undefined
  body — including a name containing `%`, `/`, and a space to pin the
  path encoding, (4) `set(name, value, scope)` routes through
  `requestStrict<T>` with method `PUT`, path
  `/api/secrets/${encodeURIComponent(name)}`, and body
  `{ value, scope }` — including the same encoding-sensitive name
  and both `scope: "project"` and `scope: "global"`,
  (5) `remove(name, scope)` routes through `request<T>` with method
  `DELETE`, path
  `/api/secrets/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
  and an undefined body — including the same encoding-sensitive name
  and both scope values, (6) `SecretListResult` decodes correctly
  through `requestStrict<T>` (empty secrets plus a multi-entry payload
  with mixed sources), (7) both `SecretGetResult` arms decode
  correctly: a `200` `{ found: true, value }` response collapses
  unchanged and a `null` (404) response collapses into
  `{ found: false }`, (8) every `SecretMutateResult` arm decodes
  correctly: `200` `{ ok: true }` for set, `null` (404) for remove
  collapses into `{ ok: false, reason: "not_found" }`, and a thrown
  transport error from `requestStrict<T>` (set) or `request<T>`
  (remove) collapses into `{ ok: false, reason: "store_error",
  message }` with the underlying error message preserved, (9) the
  assembly satisfies coverage with the secrets contribution, and
  (10) the assembly throws naming "secrets" when the contribution is
  removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"secrets"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `secrets` handler returning `{ secrets: [] }` from `list()`,
  `{ found: false }` from `get(name)`, `{ ok: true }` from
  `set(name, value, scope)`, and `{ ok: false, reason: "not_found" }`
  from `remove(name, scope)` so tests that build a
  `DaemonControlClient` purely to exercise non-namespace daemon
  behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/api/secrets` and `/api/secrets/:name` routes
  keep their HTTP verbs (GET / GET / PUT / DELETE), query-string
  contracts (`?scope=` on DELETE), and JSON-body contracts (`{ value,
  scope }` on PUT) exactly as parsed in
  `src/modules/secrets/routes.ts`. The CLI-facing `kota secrets`
  subcommands and the `get_secret` agent tool are unrelated to this
  migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` and
  `link.request<T>` through the typed `DaemonTransport`. It does not
  reach into `node:http`, the bearer token, or
  `.kota/daemon-control.json`. The HTTP method and path stay byte-for-
  byte identical to today's wire code, including
  `encodeURIComponent(name)` on every per-secret path and
  `encodeURIComponent(scope)` on the DELETE query string so any
  embedded slashes, percents, or spaces in the secret name continue
  to round-trip safely.
- No legacy or compatibility surface. Delete `listSecretsHttp`,
  `getSecretHttp`, `setSecretHttp`, `removeSecretHttp`, the inline
  closure, the central type declarations, and the `SecretGetResult`
  / `SecretMutateResult` / `SecretScope` imports at the migration's
  edges as it completes; do not leave shims. The in-module import
  shift in `index.ts` from `#core/server/kota-client.js` to
  `./client.js` is a hard cutover, not a parallel re-export.
- The `SecretMutateResult` two-arm shape with the optional `message`
  diagnostic is preserved exactly: `{ ok: true }` and `{ ok: false;
  reason: "not_found" | "store_error"; message?: string }`. The
  `SecretGetResult` two-arm shape (`{ found: true; value: string } |
  { found: false }`) and `SecretListResult` shape (`{ secrets:
  SecretListEntry[] }`) are preserved exactly.
- The daemon-up branch's transport-error handling preserves today's
  behavior: `set` and `remove` capture the underlying error message
  in `{ ok: false, reason: "store_error", message }`. `get` collapses
  any non-`200` response into `{ found: false }` to match today's
  silent fallthrough on transport errors. `list` collapses any
  non-`200` into `{ secrets: [] }` to match today's
  `result?.secrets ?? []` mapping in the central closure.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `SecretListEntry` / `SecretListResult` /
  `SecretScope` / `SecretGetResult` / `SecretMutateResult`
  declarations in `src/core/server/`. Existing assertions for the
  doctor, harnessParity, audit, retract, answer, ownerQuestions,
  modules, modulesAdmin, agents, skills, mcpServer, web, capture,
  recall, webhook, and approvals migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota secrets list`, `kota
  secrets get <name>`, `kota secrets set <name>`, `kota secrets
  remove <name>`), daemon-up vs daemon-down branching, and exit-code
  semantics all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  secrets module's existing CLI rendering hooks are not part of this
  refactor.

## Done When

- `src/modules/secrets/client.ts` exists and declares `SecretsClient`,
  `SecretListEntry`, `SecretListResult`, `SecretScope`,
  `SecretGetResult`, and `SecretMutateResult`. The `KotaClient`
  aggregate in `src/core/server/kota-client.ts` imports
  `SecretsClient` from this module.
- `src/modules/secrets/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/secrets/index.ts` imports `SecretsClient` from
  `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `secrets`-specific code: no `listSecretsHttp`, `getSecretHttp`,
  `setSecretHttp`, `removeSecretHttp`; no inline `secrets: { ... }`
  closure on the core-side stub builder; no `SecretGetResult` /
  `SecretMutateResult` / `SecretScope` imports; and no other
  secrets-namespace-specific helpers.
- `src/modules/secrets/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET list, the GET
  per-secret with `encodeURIComponent(name)` round-trip on a name
  with reserved characters, the PUT with method/path/body assertions
  threading both scope arms, the DELETE with method/path assertions
  threading both scope arms through `encodeURIComponent`, per-arm
  `SecretListResult` decoding, both `SecretGetResult` arms decoding
  correctly through the `null`-on-404 branch, every
  `SecretMutateResult` arm decoding correctly including the
  `store_error` thrown-transport-error mapping with message
  preservation, coverage success when the contribution is supplied,
  and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"secrets"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `secrets` handler whose four methods return the placeholder shapes
  in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `SecretListEntry` / `SecretListResult` / `SecretScope` /
  `SecretGetResult` / `SecretMutateResult` declarations in
  `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`secrets-daemon-up.txt` / `secrets-daemon-down.txt`) demonstrate
  parity for one read (`kota secrets list`) and one mutation
  (`kota secrets set <name>` followed by `kota secrets remove
  <name>` against synthetic secrets) showing the pre/post output is
  identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T01-15-42-825Z-explorer-oxqljz/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Eighteen orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the approvals migration):

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

`secrets` is the next-cleanest multi-method namespace with four short
HTTP wire calls (GET / GET / PUT / DELETE) covering its complete
daemon contract — the natural next pilot in the cluster that began
with the ownerQuestions, agents, capture, and approvals migrations. It
extends the pattern in three axes the prior pilots did not exercise:
(a) the first migration to surface the **PUT verb** with a JSON body,
validating that `link.requestStrict<T>` threads PUT method/body
through unchanged, (b) the first migration whose mutation result
carries a non-`not_found` failure arm (`{ ok: false; reason:
"store_error"; message?: string }`) exercising the `transport_error →
500-class fallback` mapping rather than only the `null`-on-404 →
`not_found` mapping that prior pilots covered, and (c) the first
migration with a **DELETE-with-query-string** request shape
(`?scope=project|global`) wired through the typed link, exercising
the path+query composition for a DELETE verb. It is needed under
every chunking answer the owner can pick (a/b/c/d/unblock): the
secrets namespace migrates exactly once regardless of whether the
parent lands in one cohesive run or fans out across follow-ups, so
this task does not commit the owner to any specific chunking answer;
it shrinks the parent task's scope by one full namespace whichever
answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `secretsModule`, the in-module import shift in `index.ts`, the
  removed `listSecretsHttp` / `getSecretHttp` / `setSecretHttp` /
  `removeSecretHttp` plus inline closure plus imports from
  `src/core/server/daemon-client.ts`, and the new daemon-side unit
  test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~30-line and ~75-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`secrets-daemon-up.txt` / `secrets-daemon-down.txt`) exercising
  one read (`kota secrets list`) and one mutation (`kota secrets
  set <name>` then `kota secrets remove <name>` against synthetic
  secrets) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `SecretListEntry` / `SecretListResult` / `SecretScope` /
  `SecretGetResult` / `SecretMutateResult` declaration in
  `src/core/server/`.
