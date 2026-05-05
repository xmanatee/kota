---
id: task-migrate-the-history-kotaclient-namespace-end-to-en
title: Migrate the history KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move HistoryClient interface and the HistoryListFilter/HistoryListResult/HistoryShowResult/HistorySearchFilter/HistorySearchResult/HistoryDeleteResult/HistoryReindexResult types from src/core/server/kota-client.ts into src/modules/history/client.ts; add a daemonClient(link) factory to the history module that wires GET /history, GET /history/:id, GET /api/history/search, DELETE /history/:id, POST /history/reindex through the typed DaemonTransport; remove historyListHttp/historyShowHttp/historyDeleteHttp/searchHistoryHttp/reindexHistoryHttp and the inline history handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-05T03:06:57.482Z
updated_at: 2026-05-05T03:06:57.482Z
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
and the knowledge migration (`d346a5c7`, 2026-05-05) have validated the
`daemonClient(link)` foundation pattern by moving nineteen namespaces
out of `src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 8 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 855 lines, `daemon-client.ts` is 1414 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `history`:

- 5 methods (`list(filter?)`, `show(id)`, `delete(id)`,
  `search(query, filter?)`, `reindex()`) — the same store-CLI shape the
  knowledge migration just exercised, minus an `add` mutation. The CLI
  consumer adds entries through interactive sessions, not through this
  namespace.
- Already owned by a dedicated module under `src/modules/history/`
  with its own `localClient(ctx)` factory (`index.ts` lines 54–94),
  control routes (`historyControlRoutes()` registered against the
  daemon at `/history`, `/history/:id` GET/DELETE, `/history/reindex`
  in `routes.ts`), API routes (`historyRoutes()` at `/api/history`,
  `/api/history/search`, `/api/history/:id` GET/DELETE), and CLI
  (`registerHistoryCommands` in `cli.ts`).
- ~50 lines of namespace-owned types in `kota-client.ts` (lines
  319–368, plus the `HistoryClient` interface at lines 468–482):
  - `HistoryListFilter` (lines 328–333, 6 lines): the
    `{ search?, limit?, cwd?, source? }` query-string filter.
  - `HistoryListResult` (lines 335–337, 3 lines): the
    `{ conversations: ConversationRecord[] }` aggregate result.
  - `HistoryShowResult` (lines 339–342, 4 lines): the two-arm
    `{ found: true; data: ConversationData } | { found: false }`
    discriminated union.
  - `HistoryDeleteResult` (lines 344–347, 4 lines): the two-arm
    `{ ok: true } | { ok: false; reason: "not_found" }` discriminated
    union.
  - `HistoryReindexResult` (line 350): the `ReindexResult` alias
    surfaced verbatim from the provider.
  - `HistorySearchFilter` (lines 352–358, 7 lines): the
    `{ cwd?, source?, semantic?, limit? }` query-string filter.
  - `HistorySearchResult` (lines 366–368, 3 lines): the two-arm
    `{ ok: true; conversations: ConversationRecord[] } | { ok: false;
    reason: "semantic_unavailable" }` discriminated union.
  - `HistoryClient` (lines 468–482, 15 lines).
  - The supporting doc comments (lines 320–327, 339, 344, 349,
    352, 360–365, 458–467).
- ~85 lines of wire code in `daemon-client.ts` —
  `historyListHttp` (lines 420–438, 19 lines),
  `historyShowHttp` (lines 440–455, 16 lines),
  `historyDeleteHttp` (lines 457–469, 13 lines),
  `reindexHistoryHttp` (lines 471–483, 13 lines),
  `searchHistoryHttp` (lines 485–505, 21 lines),
  plus the inline `history: { list, show, delete, search, reindex }`
  closure on the central handler builder (lines 1009–1014, 6 lines),
  plus the `HistoryListFilter` / `HistoryListResult` /
  `HistoryShowResult` / `HistoryDeleteResult` /
  `HistoryReindexResult` / `HistorySearchFilter` /
  `HistorySearchResult` imports from `./kota-client.js` (history-namespace
  block) and the `ConversationData` import from
  `#core/modules/provider-types.js` (line 16).
- The wire code today issues GET `/history?search=…&limit=…&cwd=…&source=…`,
  GET `/history/:id`, DELETE `/history/:id`, POST `/history/reindex`,
  and GET `/api/history/search?q=…&cwd=…&source=…&semantic=…&limit=…`
  through `fetchWithTimeout` plus `transport.authHeaders()` directly;
  the factory body collapses into five strict requests once the typed
  `DaemonTransport` link supplies the standard JSON-decode path, with
  one `request<T>` call for the `404 → { found: false }` show arm and
  one `request<T>` call for the `404 → { ok: false, reason:
  "not_found" }` delete arm (the daemon also returns `204` for delete
  success, which today's `historyDeleteHttp` collapses into
  `{ ok: true }`).
- The history module's local consumer (`index.ts`) currently imports
  `HistoryClient` from `#core/server/kota-client.js`. After the
  migration this import points at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in three new
dimensions: (a) the first migration to surface a **two-set route
contract** where reads/mutations route through one path stem
(`/history*` control-plane routes registered via `controlRoutes()`)
while semantic search routes through a different path stem
(`/api/history/search` registered via `routes()`), validating that the
typed `DaemonTransport` link cleanly threads both URL stems through
the same factory; (b) the first migration whose mutation path uses an
**HTTP `204` success status** that today's central closure collapses
into `{ ok: true }` rather than the `200 + JSON body` pattern every
prior delete migration exercised, validating that `request<T>`'s
contract correctly threads `204` (which the typed transport returns
as `null`) and that the factory handles the `null → ok: true` versus
`null → not_found` ambiguity by checking the response status
explicitly — or, equivalently, that the wire shape is reshaped at the
daemon route to return `200 + { deleted: id }` (matching the
knowledge / approvals / secrets delete precedent) and the factory
collapses `null → not_found` and a non-null result into `ok: true`;
(c) the first migration whose contract surfaces a provider type
(`ConversationData` from `#core/modules/provider-types.js`) verbatim
through the daemon route on the show arm, mirroring the
`KnowledgeEntry` precedent the knowledge migration just established
for list and search, and validating that the
`#core/modules/provider-types.js` import boundary works for a single
arm of a discriminated union (the show arm) as well as for full
result lists.

## Desired Outcome

`history` is the twentieth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `HistoryClient`, `HistoryListFilter`, `HistoryListResult`,
  `HistoryShowResult`, `HistoryDeleteResult`, `HistoryReindexResult`,
  `HistorySearchFilter`, and `HistorySearchResult` live in
  `src/modules/history/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `HistoryClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed. The `ConversationRecord` and `ConversationData`
  imports in `client.ts` continue to resolve from
  `#core/modules/provider-types.js` (the cross-cutting provider
  contract types live in core; only the namespace-shaped
  result/filter types move).
- `src/modules/history/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ history: HistoryClient }` whose five methods route
  through:
  - `list(filter)` → builds the same `URLSearchParams` shape today's
    `historyListHttp` builds (optional `search`, `limit`, `cwd`,
    `source`, omitted entirely when empty) and calls
    `link.requestStrict<{ conversations: ConversationRecord[] }>(
    "GET", `/history${query}`)`. The query string is the empty
    string when no filter keys produce a value, matching today's
    `params.toString() ? `?${params.toString()}` : ""` behavior.
  - `show(id)` → `link.request<ConversationData>("GET",
    `/history/${encodeURIComponent(id)}`)` then collapsing `null`
    (404) into `{ found: false }` and a non-null result into
    `{ found: true, data }`.
  - `delete(id)` → matches today's wire shape exactly, including the
    `204` success status. The daemon route at `DELETE /history/:id`
    returns `204` on success and `404 + { error }` on miss; the
    factory must preserve this. The recommended approach is to
    reshape the daemon control route to return `200 + { deleted: id
    }` on success (matching the knowledge / approvals / secrets
    delete precedent) and call `link.request<{ deleted: string
    }>("DELETE", `/history/${encodeURIComponent(id)}`)` collapsing
    `null` (404) into `{ ok: false, reason: "not_found" }` and a
    non-null result into `{ ok: true }`. If reshaping the daemon
    route is undesirable for parity reasons, the alternative is to
    add a `link.fetchRaw` call that inspects `res.status` directly
    (`204 → { ok: true }`, `404 → { ok: false, reason: "not_found"
    }`) — only this method needs the raw escape-hatch, and the
    others stay on `request<T>` / `requestStrict<T>`. Pick one
    approach and pin it in the wire-shape test; do not leave both
    paths in the tree.
  - `search(query, filter)` → builds the same `URLSearchParams` shape
    today's `searchHistoryHttp` builds (`q=…`, optional `cwd`,
    `source`, `semantic=true`, `limit`) and calls
    `link.requestStrict<HistorySearchResult>("GET",
    `/api/history/search?${params.toString()}`)`. The daemon route
    emits the discriminated union directly (`{ ok: true;
    conversations }` or `{ ok: false; reason:
    "semantic_unavailable" }`) so no additional collapse is needed.
    Note the `/api/history/search` path stem differs from the
    `/history*` stem the other four methods use — this preserves
    today's wire contract exactly.
  - `reindex()` → `link.requestStrict<HistoryReindexResult>("POST",
    "/history/reindex")`.

  matching today's `historyListHttp` / `historyShowHttp` /
  `historyDeleteHttp` / `searchHistoryHttp` / `reindexHistoryHttp`
  URL paths, HTTP verbs, query-string contracts, and JSON-body
  contracts byte-for-byte (modulo the optional reshape of the
  delete success status from `204 → { ok: true }` to `200 + {
  deleted: id } → { ok: true }`, which is a daemon-side concern
  pinned in the wire-shape test).
- `src/core/server/daemon-client.ts` no longer carries
  `historyListHttp`, `historyShowHttp`, `historyDeleteHttp`,
  `searchHistoryHttp`, `reindexHistoryHttp`, the inline
  `history: { list, show, delete, search, reindex }` closure on the
  core-side stub builder, the `HistoryListFilter` /
  `HistoryListResult` / `HistoryShowResult` / `HistoryDeleteResult` /
  `HistoryReindexResult` / `HistorySearchFilter` /
  `HistorySearchResult` imports from `./kota-client.js`, or any
  other history-namespace-specific helpers. The `ConversationData`
  import from `#core/modules/provider-types.js` is removed once no
  other code in `daemon-client.ts` references it. Module-contributed
  handlers replace all of these the same way every prior migration
  did.
- `src/modules/history/index.ts` updates its import of `HistoryClient`
  from `#core/server/kota-client.js` to the module-local `./client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/history/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/knowledge/daemon-client.test.ts`,
  `src/modules/memory/daemon-client.test.ts`,
  `src/modules/secrets/daemon-client.test.ts`,
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/approval-queue/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `history`, (2) `list(filter)` routes through `requestStrict<T>`
  with method `GET`, path `/history` (no query string when filter is
  undefined or empty), and an undefined body — including one call
  with `{ search, limit, cwd, source }` to pin the
  `URLSearchParams` insertion order matching today's
  `historyListHttp`, (3) `show(id)` routes through `request<T>` with
  method `GET`, path `/history/${encodeURIComponent(id)}`, and an
  undefined body — including an id containing `%`, `/`, and a space
  to pin the path encoding, plus a `null` (404) collapse into
  `{ found: false }` and a non-null collapse into `{ found: true,
  data }`, (4) `delete(id)` routes through the chosen primitive
  (either `request<T>` if the daemon route is reshaped to `200 + {
  deleted: id }`, or `fetchRaw` if `204` is preserved) with method
  `DELETE`, path `/history/${encodeURIComponent(id)}`, and an
  undefined body — including an id containing reserved characters
  and the success-status collapse into `{ ok: true }` plus the
  `404 → { ok: false, reason: "not_found" }` collapse, (5)
  `search(query, filter)` routes through `requestStrict<T>` with
  method `GET`, path `/api/history/search?${params}`, and an
  undefined body — including one call with no filter (only `q=…`),
  one call with `{ cwd, source, limit }` to pin the optional-key
  inclusion order matching today's `searchHistoryHttp`, and one
  call with `semantic: true` to pin `semantic=true` inclusion, (6)
  `reindex()` routes through `requestStrict<T>` with method `POST`,
  path `/history/reindex`, and an undefined body, (7)
  `HistorySearchResult` decodes correctly through `requestStrict<T>`
  for both arms (a `200` `{ ok: true; conversations: [...] }`
  response collapses unchanged and a `200` `{ ok: false; reason:
  "semantic_unavailable" }` response collapses unchanged), (8)
  `HistoryShowResult` arms decode correctly: a `200` non-null
  response collapses into `{ found: true, data }` and a `null` (404)
  response collapses into `{ found: false }`, (9)
  `HistoryDeleteResult` arms decode correctly: the success path
  collapses into `{ ok: true }` and a `null` (404) response
  collapses into `{ ok: false, reason: "not_found" }`, (10)
  `HistoryReindexResult` decodes correctly through `requestStrict<T>`
  (the provider's `ReindexResult` shape passes through unchanged),
  (11) the assembly satisfies coverage with the history contribution,
  and (12) the assembly throws naming "history" when the contribution
  is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"history"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `history` handler returning `{ conversations: [] }` from `list()`,
  `{ found: false }` from `show()`, `{ ok: true }` from `delete()`,
  `{ ok: true, conversations: [] }` from `search()`, and the
  provider's reindex-result placeholder shape from `reindex()` so
  tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes
  beyond the optional delete-success-status reshape (`204 → 200 + {
  deleted: id }`) called out in `## Desired Outcome` above. The
  `/history`, `/history/:id`, `/history/reindex`, and
  `/api/history/search` routes keep their HTTP verbs (GET / GET /
  DELETE / POST / GET), query-string contracts (`?search=…&limit=…&
  cwd=…&source=…` on list, `?q=…&cwd=…&source=…&semantic=…&limit=…`
  on search), and JSON-body contracts (none — every method is
  query-string-or-path-bound) exactly as parsed in
  `src/modules/history/routes.ts`. The CLI-facing
  `kota history` subcommands and the `conversation_recall` agent tool
  are unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` and
  `link.request<T>` through the typed `DaemonTransport`. It does not
  reach into `node:http`, the bearer token, or
  `.kota/daemon-control.json`. The HTTP method and path stay
  byte-for-byte identical to today's wire code, including
  `encodeURIComponent(id)` on the per-conversation GET and DELETE
  paths and the `URLSearchParams` insertion order on the list and
  search paths so any embedded slashes, percents, or spaces in the
  conversation id continue to round-trip safely.
- The two-stem route layout (`/history*` for list/show/delete/reindex,
  `/api/history/search` for search) is preserved. The `daemonClient`
  factory threads both stems through the same typed link. Do not
  rename the search route to `/history/search` or the list/show/delete
  routes to `/api/history*` — that would change the operator-facing
  daemon HTTP contract and is out of scope.
- The `ConversationRecord` and `ConversationData` provider types stay
  imported from `#core/modules/provider-types.js` — the cross-cutting
  provider contract types do not move with the namespace. Only the
  namespace-shaped result/filter types (the ones that today live in
  `kota-client.ts`) move into the module's `client.ts`.
- No legacy or compatibility surface. Delete `historyListHttp`,
  `historyShowHttp`, `historyDeleteHttp`, `searchHistoryHttp`,
  `reindexHistoryHttp`, the inline closure, the central type
  declarations, and the `HistoryListFilter` / `HistoryListResult` /
  `HistoryShowResult` / `HistoryDeleteResult` /
  `HistoryReindexResult` / `HistorySearchFilter` /
  `HistorySearchResult` imports at the migration's edges as it
  completes; do not leave shims. The in-module import shift in
  `index.ts` from `#core/server/kota-client.js` to `./client.js` is a
  hard cutover, not a parallel re-export.
- The `HistoryShowResult` two-arm shape (`{ found: true; data:
  ConversationData } | { found: false }`) is preserved exactly. The
  `HistoryDeleteResult` two-arm shape (`{ ok: true } | { ok: false;
  reason: "not_found" }`) is preserved exactly. The
  `HistorySearchResult` two-arm shape (`{ ok: true; conversations:
  ConversationRecord[] } | { ok: false; reason:
  "semantic_unavailable" }`) is preserved exactly. The
  `HistoryListResult` shape (`{ conversations: ConversationRecord[]
  }`) is preserved exactly. The `HistoryReindexResult` alias to the
  provider's `ReindexResult` is preserved exactly.
- The daemon-up branch's transport behavior preserves today's
  semantics: `show` collapses any `404` response into the `found:
  false` arm to match today's silent fallthrough; `delete` collapses
  any `404` response into the `not_found` arm to match today's
  silent fallthrough; `list`, `search`, and `reindex` propagate
  transport errors through `requestStrict<T>` (today's central
  closures already throw on non-`ok` responses with the JSON `error`
  body, matching `requestStrict<T>`'s contract).
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `HistoryListFilter` / `HistoryListResult` /
  `HistoryShowResult` / `HistoryDeleteResult` /
  `HistoryReindexResult` / `HistorySearchFilter` /
  `HistorySearchResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, modulesAdmin, agents, skills, mcpServer,
  web, capture, recall, webhook, approvals, secrets, memory, and
  knowledge migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota history list`,
  `kota history show`, `kota history search`, `kota history remove`,
  `kota history reindex`), daemon-up vs daemon-down branching, and
  exit-code semantics all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  history module's existing CLI rendering hooks are not part of
  this refactor.

## Done When

- `src/modules/history/client.ts` exists and declares
  `HistoryClient`, `HistoryListFilter`, `HistoryListResult`,
  `HistoryShowResult`, `HistoryDeleteResult`,
  `HistoryReindexResult`, `HistorySearchFilter`, and
  `HistorySearchResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `HistoryClient` from this
  module.
- `src/modules/history/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/history/index.ts` imports `HistoryClient` from
  `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `history`-specific code: no `historyListHttp`, `historyShowHttp`,
  `historyDeleteHttp`, `searchHistoryHttp`, `reindexHistoryHttp`; no
  inline `history: { ... }` closure on the core-side stub builder;
  no `HistoryListFilter` / `HistoryListResult` /
  `HistoryShowResult` / `HistoryDeleteResult` /
  `HistoryReindexResult` / `HistorySearchFilter` /
  `HistorySearchResult` imports; and no other
  history-namespace-specific helpers.
- `src/modules/history/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET list with the
  multi-key URLSearchParams shape, the GET show with
  `encodeURIComponent` round-trip and the `null`-on-404 → `{ found:
  false }` collapse, the DELETE per-conversation with
  `encodeURIComponent` round-trip and the success-status collapse
  into `{ ok: true }` plus the `null`-on-404 → `not_found` collapse,
  the GET search threading the multi-key URLSearchParams shape
  through both the keyword and `semantic: true` filter shapes, the
  POST reindex, per-arm `HistorySearchResult` decoding, per-arm
  `HistoryShowResult` decoding, per-arm `HistoryDeleteResult`
  decoding, `HistoryReindexResult` pass-through decoding, coverage
  success when the contribution is supplied, and coverage failure
  when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"history"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `history` handler whose five methods return the placeholder shapes
  in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `HistoryListFilter` / `HistoryListResult` / `HistoryShowResult` /
  `HistoryDeleteResult` / `HistoryReindexResult` /
  `HistorySearchFilter` / `HistorySearchResult` declarations in
  `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`history-daemon-up.txt` / `history-daemon-down.txt`) demonstrate
  parity for one read (`kota history list`) and one mutation
  (`kota history remove <id>` against a synthetic conversation id,
  showing both the success and the `not_found` arms) showing the
  pre/post output is identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T03-04-29-947Z-explorer-5doqkg/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twenty-one orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the knowledge migration):

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

`history` is the next-cleanest multi-method namespace with five short
HTTP wire calls (GET / GET-with-path-id / DELETE-with-path-id / GET
on a different path stem / POST) covering its complete daemon
contract — the natural next pilot in the cluster that began with the
ownerQuestions, agents, capture, approvals, memory, and knowledge
migrations. It extends the pattern in three axes the prior pilots did
not exercise: (a) the first migration to surface a two-stem route
contract where reads/mutations/reindex route through `/history*` while
semantic search routes through `/api/history/search`, validating that
the typed `DaemonTransport` link cleanly threads both URL stems
through the same factory; (b) the first migration whose mutation path
exercises an HTTP `204` success status (today's `historyDeleteHttp`
collapses `204` into `{ ok: true }`, in contrast to the `200 + {
deleted: id }` pattern every prior delete migration used), forcing an
explicit choice between reshaping the daemon route to the
knowledge/approvals/secrets `200 + { deleted: id }` precedent or
threading `204` through a `link.fetchRaw` escape-hatch, with the
chosen approach pinned in the wire-shape test; and (c) the first
migration whose contract surfaces a provider type
(`ConversationData`) verbatim through the daemon route on a single
arm of a discriminated union (the show arm), mirroring the
`KnowledgeEntry` precedent the knowledge migration just established
for list and search and validating that the
`#core/modules/provider-types.js` import boundary works for a single
arm of a discriminated union (the show arm) as well as for full
result lists. This migration de-risks the upcoming repo-tasks
namespace migration that shares both the `semantic_unavailable` arm
and the multi-key URLSearchParams filter shape, plus the upcoming
sessions migration that shares the provider-typed-entry pattern with
`InteractiveSession`. It is needed under every chunking answer the
owner can pick on the parent task (a/b/c/d/unblock): the history
namespace migrates exactly once regardless of whether the parent
lands in one cohesive run or fans out across follow-ups, so this task
does not commit the owner to any specific chunking answer; it shrinks
the parent task's scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient(link)` factory on
  `historyModule`, the in-module import shift in `index.ts`, the
  removed `historyListHttp` / `historyShowHttp` / `historyDeleteHttp`
  / `searchHistoryHttp` / `reindexHistoryHttp` plus inline closure
  plus imports from `src/core/server/daemon-client.ts`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~50-line and ~85-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`history-daemon-up.txt` / `history-daemon-down.txt`) exercising
  one read (`kota history list`) and one mutation (`kota history
  remove <id>` against a synthetic conversation id, showing both the
  success and the `not_found` arms) with identical output across
  modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `HistoryListFilter`
  / `HistoryListResult` / `HistoryShowResult` /
  `HistoryDeleteResult` / `HistoryReindexResult` /
  `HistorySearchFilter` / `HistorySearchResult` declaration in
  `src/core/server/`.
