---
id: task-migrate-the-webhook-kotaclient-namespace-end-to-en
title: Migrate the webhook KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move WebhookClient interface and the WebhookListEntry/WebhookListResult/WebhookSecretGenerateResult/WebhookSecretRemoveResult types from src/core/server/kota-client.ts into src/modules/webhook/client.ts; add a daemonClient(link) factory to the webhook module that wires GET /webhooks, POST /webhooks/:workflow/secret, and DELETE /webhooks/:workflow/secret through the typed DaemonTransport; remove listWebhooksHttp/generateWebhookSecretHttp/removeWebhookSecretHttp and the inline webhook handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-04T14:17:40.526Z
updated_at: 2026-05-04T14:31:06.822Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), and the recall migration (`5ab2bd0b`,
2026-05-04) have validated the `daemonClient(link)` foundation pattern
by moving fourteen namespaces out of `src/core/server/kota-client.ts`
and `src/core/server/daemon-client.ts` into their owning modules. 13
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1123 lines,
`daemon-client.ts` is 1828 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `webhook`:

- 3 methods (`list()`, `secretGenerate(workflow)`, `secretRemove(workflow)`) —
  same ~3-method shape as several prior pilots.
- Already owned by a dedicated module under `src/modules/webhook/` with
  its own `localClient(ctx)` factory (`index.ts`), control routes
  (`webhookSecretControlRoutes` registered against the daemon at
  `/webhooks` and `/webhooks/:workflow/secret` in `secret-routes.ts`),
  module operations (`webhook-operations.ts`), config slice
  (`config-slice.ts`), and CLI (`cli.ts`).
- ~48 lines of namespace-owned types in `kota-client.ts` (lines
  737–784):
  - `WebhookListEntry` (lines 742–745, 4 lines): the `{ workflow,
    hasSecret }` per-entry shape.
  - `WebhookListResult` (lines 747–749, 3 lines): the `{ entries }`
    aggregate result.
  - `WebhookSecretGenerateResult` (lines 755–760, 6 lines): the
    `{ workflow, secret, overwrote }` shape returning the freshly
    generated HMAC secret exactly once.
  - `WebhookSecretRemoveResult` (lines 766–768, 3 lines): the two-arm
    `{ ok: true; workflow; removed: true | false }` discriminated
    union.
  - `WebhookClient` (lines 780–784, 5 lines).
  - The supporting doc comments (lines 737–741, 751–754, 762–765,
    770–779).
- ~42 lines of wire code in `daemon-client.ts` —
  `listWebhooksHttp` (lines 295–306, 12 lines), `generateWebhookSecretHttp`
  (lines 308–321, 14 lines), and `removeWebhookSecretHttp` (lines
  323–336, 14 lines) plus the inline `webhook: { list, secretGenerate,
  secretRemove }` closure on the central handler builder (lines
  1434–1438).
- The wire code already issues GET `/webhooks`, POST
  `/webhooks/:workflow/secret`, and DELETE `/webhooks/:workflow/secret`
  through `fetchWithTimeout` and decodes the typed result; the factory
  body collapses into three strict requests once the typed
  `DaemonTransport` link supplies the standard JSON-decode path.
- The webhook module's local consumers (`index.ts`, `webhook-operations.ts`,
  `cli.test.ts`) currently import `WebhookClient` /
  `WebhookListResult` / `WebhookSecretGenerateResult` /
  `WebhookSecretRemoveResult` from `#core/server/kota-client.js`. After
  the migration these imports point at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in two new
dimensions: (a) the first migration to exercise the **DELETE verb**
through `requestStrict<T>` (every prior pilot used GET / POST), and
(b) path parameters carrying an `encodeURIComponent`-escaped workflow
id in two of the three methods, validating that the typed link
preserves the byte-for-byte URL shape today's wire code emits.

## Desired Outcome

`webhook` is the fifteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `WebhookClient`, `WebhookListEntry`, `WebhookListResult`,
  `WebhookSecretGenerateResult`, and `WebhookSecretRemoveResult` live
  in `src/modules/webhook/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports `WebhookClient`
  from this module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/webhook/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ webhook: WebhookClient }` whose three methods route
  through:
  - `list()` →
    `link.requestStrict<WebhookListResult>("GET", "/webhooks")`
  - `secretGenerate(workflow)` →
    `link.requestStrict<WebhookSecretGenerateResult>("POST", "/webhooks/${encodeURIComponent(workflow)}/secret")`
  - `secretRemove(workflow)` →
    `link.requestStrict<WebhookSecretRemoveResult>("DELETE", "/webhooks/${encodeURIComponent(workflow)}/secret")`

  matching today's `listWebhooksHttp` / `generateWebhookSecretHttp` /
  `removeWebhookSecretHttp` URL paths and HTTP verbs byte-for-byte.
  None of the three methods carry a request body.
- `src/core/server/daemon-client.ts` no longer carries
  `listWebhooksHttp`, `generateWebhookSecretHttp`,
  `removeWebhookSecretHttp`, the inline
  `webhook: { list, secretGenerate, secretRemove }` closure on the
  core-side stub builder, the `WebhookListResult` /
  `WebhookSecretGenerateResult` / `WebhookSecretRemoveResult` imports
  from `./kota-client.js`, or any other webhook-specific code. Module-
  contributed handlers replace all of these the same way every prior
  migration did.
- `src/modules/webhook/index.ts` and
  `src/modules/webhook/webhook-operations.ts` update their imports of
  `WebhookClient`, `WebhookListResult`, `WebhookSecretGenerateResult`,
  and `WebhookSecretRemoveResult` from `#core/server/kota-client.js`
  to the module-local `./client.js`. Every other in-module consumer of
  these types (`cli.test.ts`) follows the same shift.
- A new daemon-side factory unit test alongside the module
  (`src/modules/webhook/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/recall/daemon-client.test.ts`,
  `src/modules/capture/daemon-client.test.ts`, and the prior
  multi-method pilots like
  `src/modules/answer/daemon-client.test.ts` and
  `src/modules/owner-questions/daemon-client.test.ts`. The test pins
  (1) the factory contributes `webhook`, (2) `list()` routes through
  `requestStrict<T>` with method `GET`, path `/webhooks`, and an
  undefined body, (3) `secretGenerate(workflow)` routes through
  `requestStrict<T>` with method `POST`, path
  `/webhooks/${encodeURIComponent(workflow)}/secret`, and an undefined
  body — including a workflow id containing `%`, `/`, and a space to
  pin the path encoding, (4) `secretRemove(workflow)` routes through
  `requestStrict<T>` with method `DELETE`, path
  `/webhooks/${encodeURIComponent(workflow)}/secret`, and an undefined
  body — including the same encoding-sensitive workflow id, (5) every
  `WebhookListResult` arm decodes correctly through `requestStrict<T>`
  (empty entries plus a multi-entry payload mixing
  `hasSecret: true` / `hasSecret: false`), (6) every
  `WebhookSecretGenerateResult` arm decodes through `requestStrict<T>`
  (`overwrote: false` and `overwrote: true`), (7) every
  `WebhookSecretRemoveResult` arm decodes through `requestStrict<T>`
  (`removed: true` and `removed: false`), (8) the assembly satisfies
  coverage with the webhook contribution, and (9) the assembly throws
  naming "webhook" when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"webhook"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `webhook` handler returning `{ entries: [] }` from `list()`,
  `{ workflow, secret: "stub-secret", overwrote: false }` from
  `secretGenerate(workflow)`, and
  `{ ok: true, workflow, removed: false }` from `secretRemove(workflow)`
  so tests that build a `DaemonControlClient` purely to exercise non-
  namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/webhooks` and `/webhooks/:workflow/secret`
  control routes keep their HTTP verbs and (empty) request body
  contracts exactly as parsed in `src/modules/webhook/secret-routes.ts`.
  The CLI-facing `kota webhook` subcommands and the inbound
  `POST /api/events/:name` event-trigger route are unrelated to this
  migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`. The HTTP method and
  path stay byte-for-byte identical to today's wire code, including
  `encodeURIComponent(workflow)` on both secret routes so embedded
  slashes, percents, or spaces in the workflow id continue to round-
  trip safely.
- No legacy or compatibility surface. Delete `listWebhooksHttp`,
  `generateWebhookSecretHttp`, `removeWebhookSecretHttp`, the inline
  closure, the central type declarations, and the
  `WebhookListResult` / `WebhookSecretGenerateResult` /
  `WebhookSecretRemoveResult` imports at the migration's edges as it
  completes; do not leave shims. The in-module import shifts in
  `index.ts`, `webhook-operations.ts`, and `cli.test.ts` from
  `#core/server/kota-client.js` to `./client.js` are hard cutovers,
  not parallel re-exports.
- The two-arm `WebhookSecretRemoveResult` discriminated union is
  preserved exactly: `{ ok: true; workflow; removed: true }` and
  `{ ok: true; workflow; removed: false }`. The `WebhookListEntry`
  shape (`{ workflow, hasSecret }`) and `WebhookSecretGenerateResult`
  shape (`{ workflow, secret, overwrote }`) are preserved exactly.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `WebhookListResult` / `WebhookSecretGenerateResult` /
  `WebhookSecretRemoveResult` / `WebhookListEntry` declarations in
  `src/core/server/`. Existing assertions for the doctor,
  harnessParity, audit, retract, answer, ownerQuestions, modules,
  modulesAdmin, agents, skills, mcpServer, web, capture, and recall
  migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota webhook list`, `kota webhook
  secret generate <workflow>`, `kota webhook secret remove <workflow>`),
  daemon-up vs daemon-down branching, and `--json` output all continue
  to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  webhook module's existing rendering hooks (`cli.ts`) are not part of
  this refactor.

## Done When

- `src/modules/webhook/client.ts` exists and declares `WebhookClient`,
  `WebhookListEntry`, `WebhookListResult`,
  `WebhookSecretGenerateResult`, and `WebhookSecretRemoveResult`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `WebhookClient` from this module.
- `src/modules/webhook/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/webhook/index.ts` and
  `src/modules/webhook/webhook-operations.ts` import `WebhookClient`
  / `WebhookListResult` / `WebhookSecretGenerateResult` /
  `WebhookSecretRemoveResult` from `./client.js` (not from
  `#core/server/kota-client.js`). Every other in-module consumer
  (`cli.test.ts`) follows the same shift.
- `src/core/server/daemon-client.ts` no longer carries any
  `webhook`-specific code: no `listWebhooksHttp`,
  `generateWebhookSecretHttp`, or `removeWebhookSecretHttp`; no inline
  `webhook: { ... }` closure on the core-side stub builder; no
  `WebhookListResult` / `WebhookSecretGenerateResult` /
  `WebhookSecretRemoveResult` imports; and no other webhook-specific
  helpers.
- `src/modules/webhook/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, three wire-shape assertions covering GET / POST / DELETE
  with method/path/body assertions including the
  `encodeURIComponent(workflow)` round-trip on a workflow id with
  reserved characters, per-arm `WebhookListResult` /
  `WebhookSecretGenerateResult` / `WebhookSecretRemoveResult` decoding
  covering both `overwrote` arms and both `removed` arms, coverage
  success when the contribution is supplied, and coverage failure
  when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"webhook"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `webhook` handler whose three methods return the placeholder shapes
  in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `WebhookListResult`
  / `WebhookSecretGenerateResult` / `WebhookSecretRemoveResult`
  declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`webhook-daemon-up.txt` / `webhook-daemon-down.txt`) demonstrate
  parity for one read (`kota webhook list`) and one mutation (`kota
  webhook secret generate <workflow>` followed by `kota webhook secret
  remove <workflow>`) showing the pre/post output is identical across
  modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-04T14-14-51-805Z-explorer-2xjuaq/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Sixteen orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the recall migration):

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
- `e0e9aa93` — capture migration extending the pattern to a
  four-arm `CaptureResult` discriminated union (one `ok: true` arm
  with a four-arm `CaptureRecord` sub-union plus three distinct
  `ok: false` `reason` arms with per-arm payload fields).
- `5ab2bd0b` — recall migration extending the pattern to a five-arm
  `RecallHit` discriminated union (knowledge / memory / history /
  tasks / answer) including a nested four-arm `result` union on the
  answer arm, plus a two-arm `RecallResult` envelope.

`webhook` is the next-cleanest multi-method namespace with three short
HTTP wire calls (GET / POST / DELETE) covering its complete daemon
contract — the natural next pilot in the cluster that began with the
ownerQuestions, agents, and capture migrations. It extends the pattern
in two axes the prior pilots did not exercise: (a) the **DELETE verb**
through `requestStrict<T>` (every prior pilot used GET or POST), and
(b) `encodeURIComponent`-escaped workflow id path parameters in two of
three methods, validating that the typed link preserves the byte-for-
byte URL shape today's wire code emits when the workflow id contains
reserved characters. It is needed under every chunking answer the
owner can pick (a/b/c/d/unblock): the webhook namespace migrates
exactly once regardless of whether the parent lands in one cohesive
run or fans out across follow-ups, so this task does not commit the
owner to any specific chunking answer; it shrinks the parent task's
scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `webhookModule`, the in-module import shifts in `index.ts`,
  `webhook-operations.ts`, and `cli.test.ts`, the removed
  `listWebhooksHttp` / `generateWebhookSecretHttp` /
  `removeWebhookSecretHttp` plus inline closure plus imports from
  `src/core/server/daemon-client.ts`, and the new daemon-side unit
  test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~48-line and ~50-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`webhook-daemon-up.txt` / `webhook-daemon-down.txt`) exercising
  one read (`kota webhook list`) and one mutation (`kota webhook
  secret generate <workflow>` then `kota webhook secret remove
  <workflow>`) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `WebhookListResult`
  / `WebhookSecretGenerateResult` / `WebhookSecretRemoveResult`
  declaration in `src/core/server/`.
