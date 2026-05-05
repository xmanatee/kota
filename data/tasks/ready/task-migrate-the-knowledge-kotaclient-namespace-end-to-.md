---
id: task-migrate-the-knowledge-kotaclient-namespace-end-to-
title: Migrate the knowledge KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move KnowledgeClient interface and the KnowledgeListFilter/KnowledgeListResult/KnowledgeShowResult/KnowledgeSearchFilter/KnowledgeSearchResult/KnowledgeAddOptions/KnowledgeAddResult/KnowledgeDeleteResult/KnowledgeReindexResult/KnowledgeScope/KnowledgeWritableScope types from src/core/server/kota-client.ts into src/modules/knowledge/client.ts; add a daemonClient(link) factory to the knowledge module that wires GET /api/knowledge, GET /api/knowledge/:id, GET /api/knowledge/search, POST /api/knowledge, DELETE /api/knowledge/:id, POST /api/knowledge/reindex through the typed DaemonTransport; remove listKnowledgeHttp/showKnowledgeHttp/searchKnowledgeHttp/addKnowledgeHttp/deleteKnowledgeHttp/reindexKnowledgeHttp and the inline knowledge handler closure from src/core/server/daemon-client.ts.
created_at: 2026-05-05T02:30:46.839Z
updated_at: 2026-05-05T02:30:46.839Z
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
the secrets migration (`5841c7f0`), and the memory migration
(`5bcc9e24`, 2026-05-05) have validated the `daemonClient(link)`
foundation pattern by moving eighteen namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 9 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 946 lines, `daemon-client.ts` is 1541 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `knowledge`:

- 6 methods (`list(filter?)`, `show(id)`, `search(query, filter?)`,
  `add(options)`, `delete(id)`, `reindex()`) — the same store-CLI
  shape memory just exercised, plus a `show(id)` GET-by-path-id branch
  with a `{ found: true; entry } | { found: false }` discriminator
  that the prior single-arm migrations did not have.
- Already owned by a dedicated module under
  `src/modules/knowledge/` with its own `localClient(ctx)` factory
  (`index.ts` lines 53–114), control routes (`knowledgeRoutes()`
  registered against the daemon at `/api/knowledge`,
  `/api/knowledge/search`, `/api/knowledge/reindex`, and
  `/api/knowledge/:id` GET/DELETE in `routes.ts`), and CLI
  (`registerKnowledgeCommands` in `cli.ts`).
- ~70 lines of namespace-owned types in `kota-client.ts` (lines
  370–439, 566–573):
  - `KnowledgeScope` (line 371): the `"project" | "global" | "all"`
    string-literal union.
  - `KnowledgeWritableScope` (line 374): the writable-only subset
    (`"project" | "global"`).
  - `KnowledgeListFilter` (lines 384–389, 6 lines): the
    `{ tag?, type?, status?, scope? }` query-string filter.
  - `KnowledgeListResult` (lines 391–393, 3 lines): the `{ entries }`
    aggregate result.
  - `KnowledgeShowResult` (lines 396–398, 3 lines): the two-arm
    `{ found: true; entry: KnowledgeEntry } | { found: false }`
    discriminated union.
  - `KnowledgeSearchFilter` (lines 401–408, 8 lines): the
    `{ tag?, type?, status?, scope?, semantic?, limit? }` query-string
    filter.
  - `KnowledgeSearchResult` (lines 416–418, 3 lines): the two-arm
    `{ ok: true; entries: KnowledgeEntry[] } | { ok: false; reason:
    "semantic_unavailable" }` discriminated union.
  - `KnowledgeAddOptions` (lines 421–429, 9 lines): the
    `{ title, content, type?, tags?, status?, scope?, meta? }` request
    body shape.
  - `KnowledgeAddResult` (line 431): the `{ id }` add-result shape.
  - `KnowledgeDeleteResult` (lines 434–436, 3 lines): the two-arm
    `{ ok: true } | { ok: false; reason: "not_found" }` discriminated
    union.
  - `KnowledgeReindexResult` (line 439): the `ReindexResult` alias
    surfaced verbatim from the provider.
  - `KnowledgeClient` (lines 566–573, 8 lines).
  - The supporting doc comments (lines 370, 376–383, 395, 400, 410–415,
    420, 433, 438, 555–565).
- ~110 lines of wire code in `daemon-client.ts` —
  `listKnowledgeHttp` (lines 430–449, 20 lines),
  `showKnowledgeHttp` (lines 451–466, 16 lines),
  `searchKnowledgeHttp` (lines 468–490, 23 lines),
  `addKnowledgeHttp` (lines 492–507, 16 lines),
  `deleteKnowledgeHttp` (lines 509–523, 15 lines),
  `reindexKnowledgeHttp` (lines 525–537, 13 lines),
  plus the inline `knowledge: { list, show, search, add, delete,
  reindex }` closure on the central handler builder (lines 1135–1142,
  8 lines), plus the `KnowledgeAddOptions` / `KnowledgeAddResult` /
  `KnowledgeDeleteResult` / `KnowledgeListFilter` / `KnowledgeListResult`
  / `KnowledgeReindexResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeShowResult` imports from
  `./kota-client.js` (lines 37–45) and the `KnowledgeEntry` import
  from `#core/modules/provider-types.js` (line 17).
- The wire code today issues GET `/api/knowledge?tag=…&type=…&status=…&scope=…`,
  GET `/api/knowledge/:id`, GET `/api/knowledge/search?q=…&tag=…&type=…&status=…&scope=…&semantic=…&limit=…`,
  POST `/api/knowledge`, DELETE `/api/knowledge/:id`, and POST
  `/api/knowledge/reindex` through `fetchWithTimeout` plus
  `transport.authHeaders()` directly; the factory body collapses into
  six strict requests once the typed `DaemonTransport` link supplies
  the standard JSON-decode path, with one `request<T>` call for the
  `404 → { found: false }` show arm and one `request<T>` call for the
  `404 → { ok: false, reason: "not_found" }` delete arm.
- The knowledge module's local consumer (`index.ts`) currently imports
  `KnowledgeClient` from `#core/server/kota-client.js`. After the
  migration this import points at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in three new
dimensions: (a) the first migration to surface the
**`semantic_unavailable` discriminated-union arm wired through
`requestStrict<T>` for a multi-key URLSearchParams filter** (six
optional keys: `tag`, `type`, `status`, `scope`, `semantic`, `limit`,
versus memory's four: `tag`, `since`, `semantic`, `limit`), de-risking
the upcoming history and repo-tasks migrations that share both the
`semantic_unavailable` shape and the multi-key filter shape; (b) the
first migration carrying both a `{ found: true; entry } | { found:
false }` show-arm and a `{ ok: true } | { ok: false; reason:
"not_found" }` delete-arm in the same namespace, threading both
through `request<T>` (the agents migration covered the show pattern;
the memory migration covered the delete pattern; this is the first
namespace to thread both at once); and (c) the first migration whose
contract surfaces a provider type (`KnowledgeEntry` from
`#core/modules/provider-types.js`) verbatim through the daemon route
without a wire-shape transformation — the route emits
`{ entries: KnowledgeEntry[] }` and the factory passes that through
the `requestStrict<T>` decode unchanged, validating that the
`#core/modules/provider-types.js` import is the right boundary for
provider-typed entries imported from inside a module's `client.ts`.

## Desired Outcome

`knowledge` is the nineteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `KnowledgeClient`, `KnowledgeScope`, `KnowledgeWritableScope`,
  `KnowledgeListFilter`, `KnowledgeListResult`, `KnowledgeShowResult`,
  `KnowledgeSearchFilter`, `KnowledgeSearchResult`,
  `KnowledgeAddOptions`, `KnowledgeAddResult`,
  `KnowledgeDeleteResult`, and `KnowledgeReindexResult` live in
  `src/modules/knowledge/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `KnowledgeClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed. The `KnowledgeEntry` import in `client.ts` continues
  to resolve from `#core/modules/provider-types.js` (the cross-cutting
  provider contract type lives in core; only the namespace-shaped
  result/filter/options types move).
- `src/modules/knowledge/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ knowledge: KnowledgeClient }` whose six methods route
  through:
  - `list(filter)` → builds the same `URLSearchParams` shape today's
    `listKnowledgeHttp` builds (optional `tag`, `type`, `status`,
    `scope`, omitted entirely when empty) and calls
    `link.requestStrict<{ entries: KnowledgeEntry[] }>("GET",
    `/api/knowledge${query}`)`. The query string is the empty string
    when no filter keys produce a value, matching today's
    `params.toString() ? `?${params.toString()}` : ""` behavior.
  - `show(id)` → `link.request<KnowledgeEntry>("GET",
    `/api/knowledge/${encodeURIComponent(id)}`)` then collapsing
    `null` (404) into `{ found: false }` and a non-null result into
    `{ found: true, entry }`.
  - `search(query, filter)` → builds the same `URLSearchParams` shape
    today's `searchKnowledgeHttp` builds (`q=…`, optional `tag`,
    `type`, `status`, `scope`, `semantic=true`, `limit`) and calls
    `link.requestStrict<KnowledgeSearchResult>("GET",
    `/api/knowledge/search?${params.toString()}`)`. The daemon route
    emits the discriminated union directly (`{ ok: true; entries }`
    or `{ ok: false; reason: "semantic_unavailable" }`) so no
    additional collapse is needed.
  - `add(options)` → `link.requestStrict<{ id: string }>("POST",
    "/api/knowledge", options)` collapsing into `{ id }`. The full
    `KnowledgeAddOptions` payload threads through verbatim — the
    daemon route already accepts the same JSON shape today's
    `addKnowledgeHttp` posts.
  - `delete(id)` → `link.request<{ deleted: string }>("DELETE",
    `/api/knowledge/${encodeURIComponent(id)}`)` then collapsing
    `null` (404) into `{ ok: false, reason: "not_found" }` and a
    non-null result into `{ ok: true }`.
  - `reindex()` → `link.requestStrict<KnowledgeReindexResult>("POST",
    "/api/knowledge/reindex")`.

  matching today's `listKnowledgeHttp` / `showKnowledgeHttp` /
  `searchKnowledgeHttp` / `addKnowledgeHttp` / `deleteKnowledgeHttp` /
  `reindexKnowledgeHttp` URL paths, HTTP verbs, query-string
  contracts, and JSON-body contracts byte-for-byte.
- `src/core/server/daemon-client.ts` no longer carries
  `listKnowledgeHttp`, `showKnowledgeHttp`, `searchKnowledgeHttp`,
  `addKnowledgeHttp`, `deleteKnowledgeHttp`, `reindexKnowledgeHttp`,
  the inline `knowledge: { list, show, search, add, delete, reindex
  }` closure on the core-side stub builder, the `KnowledgeAddOptions`
  / `KnowledgeAddResult` / `KnowledgeDeleteResult` /
  `KnowledgeListFilter` / `KnowledgeListResult` /
  `KnowledgeReindexResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeShowResult` imports from
  `./kota-client.js`, or any other knowledge-namespace-specific
  helpers. The `KnowledgeEntry` import from
  `#core/modules/provider-types.js` is removed once no other code in
  `daemon-client.ts` references it. Module-contributed handlers
  replace all of these the same way every prior migration did.
- `src/modules/knowledge/index.ts` updates its import of
  `KnowledgeClient` from `#core/server/kota-client.js` to the
  module-local `./client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/knowledge/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/memory/daemon-client.test.ts`,
  `src/modules/secrets/daemon-client.test.ts`,
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/approval-queue/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `knowledge`, (2) `list(filter)` routes through `requestStrict<T>`
  with method `GET`, path `/api/knowledge` (no query string when
  filter is undefined or empty), and an undefined body — including
  one call with `{ tag, type, status, scope }` to pin the
  `URLSearchParams` insertion order matching today's
  `listKnowledgeHttp`, (3) `show(id)` routes through `request<T>`
  with method `GET`, path `/api/knowledge/${encodeURIComponent(id)}`,
  and an undefined body — including an id containing `%`, `/`, and a
  space to pin the path encoding, plus a `null` (404) collapse into
  `{ found: false }` and a non-null collapse into `{ found: true,
  entry }`, (4) `search(query, filter)` routes through
  `requestStrict<T>` with method `GET`, path
  `/api/knowledge/search?${params}`, and an undefined body — including
  one call with no filter (only `q=…`), one call with `{ tag, type,
  status, scope, limit }` to pin the optional-key inclusion order
  matching today's `searchKnowledgeHttp`, and one call with
  `semantic: true` to pin `semantic=true` inclusion, (5) `add(options)`
  routes through `requestStrict<T>` with method `POST`, path
  `/api/knowledge`, and the full `KnowledgeAddOptions` body —
  including one call with only `{ title, content }` and one call with
  every optional key (`type`, `tags`, `status`, `scope`, `meta`) to
  pin the body pass-through, (6) `delete(id)` routes through
  `request<T>` with method `DELETE`, path
  `/api/knowledge/${encodeURIComponent(id)}`, and an undefined body —
  including an id containing reserved characters and a `null` (404)
  collapse into `{ ok: false, reason: "not_found" }` and a non-null
  collapse into `{ ok: true }`, (7) `reindex()` routes through
  `requestStrict<T>` with method `POST`, path
  `/api/knowledge/reindex`, and an undefined body, (8)
  `KnowledgeSearchResult` decodes correctly through `requestStrict<T>`
  for both arms (a `200` `{ ok: true; entries: [...] }` response
  collapses unchanged and a `200` `{ ok: false; reason:
  "semantic_unavailable" }` response collapses unchanged), (9)
  `KnowledgeShowResult` arms decode correctly: a `200` non-null
  response collapses into `{ found: true, entry }` and a `null` (404)
  response collapses into `{ found: false }`, (10)
  `KnowledgeDeleteResult` arms decode correctly: a `200` non-null
  response collapses into `{ ok: true }` and a `null` (404) response
  collapses into `{ ok: false, reason: "not_found" }`, (11)
  `KnowledgeReindexResult` decodes correctly through `requestStrict<T>`
  (the provider's `ReindexResult` shape passes through unchanged),
  (12) the assembly satisfies coverage with the knowledge contribution,
  and (13) the assembly throws naming "knowledge" when the
  contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"knowledge"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `knowledge` handler returning `{ entries: [] }` from `list()`,
  `{ found: false }` from `show()`, `{ ok: true, entries: [] }` from
  `search()`, `{ id: "stub" }` from `add()`, `{ ok: true }` from
  `delete()`, and the provider's reindex-result placeholder shape from
  `reindex()` so tests that build a `DaemonControlClient` purely to
  exercise non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/api/knowledge`, `/api/knowledge/:id`,
  `/api/knowledge/search`, and `/api/knowledge/reindex` routes keep
  their HTTP verbs (GET / GET / DELETE / GET / POST / POST),
  query-string contracts (`?tag=…&type=…&status=…&scope=…` on list,
  `?q=…&tag=…&type=…&status=…&scope=…&semantic=…&limit=…` on search),
  and JSON-body contracts (`KnowledgeAddOptions` on POST) exactly as
  parsed in `src/modules/knowledge/routes.ts`. The CLI-facing
  `kota knowledge` subcommands and the `knowledge` agent tool are
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.requestStrict<T>` and
  `link.request<T>` through the typed `DaemonTransport`. It does not
  reach into `node:http`, the bearer token, or
  `.kota/daemon-control.json`. The HTTP method and path stay
  byte-for-byte identical to today's wire code, including
  `encodeURIComponent(id)` on the per-entry GET and DELETE paths and
  the `URLSearchParams` insertion order on the list and search paths
  so any embedded slashes, percents, or spaces in the entry id
  continue to round-trip safely.
- The `KnowledgeEntry` provider type stays imported from
  `#core/modules/provider-types.js` — the cross-cutting provider
  contract type does not move with the namespace. Only the
  namespace-shaped result/filter/options types (the ones that today
  live in `kota-client.ts`) move into the module's `client.ts`.
- No legacy or compatibility surface. Delete `listKnowledgeHttp`,
  `showKnowledgeHttp`, `searchKnowledgeHttp`, `addKnowledgeHttp`,
  `deleteKnowledgeHttp`, `reindexKnowledgeHttp`, the inline closure,
  the central type declarations, and the `KnowledgeAddOptions` /
  `KnowledgeAddResult` / `KnowledgeDeleteResult` /
  `KnowledgeListFilter` / `KnowledgeListResult` /
  `KnowledgeReindexResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeShowResult` imports at the
  migration's edges as it completes; do not leave shims. The in-module
  import shift in `index.ts` from `#core/server/kota-client.js` to
  `./client.js` is a hard cutover, not a parallel re-export.
- The `KnowledgeShowResult` two-arm shape (`{ found: true; entry:
  KnowledgeEntry } | { found: false }`) is preserved exactly. The
  `KnowledgeDeleteResult` two-arm shape (`{ ok: true } | { ok: false;
  reason: "not_found" }`) is preserved exactly. The
  `KnowledgeSearchResult` two-arm shape (`{ ok: true; entries:
  KnowledgeEntry[] } | { ok: false; reason: "semantic_unavailable"
  }`) is preserved exactly. The `KnowledgeListResult` shape (`{
  entries: KnowledgeEntry[] }`) is preserved exactly. The
  `KnowledgeAddOptions` shape (`{ title, content, type?, tags?,
  status?, scope?, meta? }`) is preserved exactly. The
  `KnowledgeAddResult` shape (`{ id: string }`) is preserved exactly.
  The `KnowledgeReindexResult` alias to the provider's `ReindexResult`
  is preserved exactly. The `KnowledgeScope` (`"project" | "global" |
  "all"`) and `KnowledgeWritableScope` (`"project" | "global"`)
  string-literal unions are preserved exactly.
- The daemon-up branch's transport behavior preserves today's
  semantics: `show` collapses any `404` response into the `found:
  false` arm to match today's silent fallthrough; `delete` collapses
  any `404` response into the `not_found` arm to match today's silent
  fallthrough; `list`, `search`, `add`, and `reindex` propagate
  transport errors through `requestStrict<T>` (today's central
  closures already throw on non-`ok` responses with the JSON `error`
  body, matching `requestStrict<T>`'s contract).
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `KnowledgeListFilter` / `KnowledgeListResult` /
  `KnowledgeShowResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeAddOptions` /
  `KnowledgeAddResult` / `KnowledgeDeleteResult` /
  `KnowledgeReindexResult` / `KnowledgeScope` /
  `KnowledgeWritableScope` declarations in `src/core/server/`.
  Existing assertions for the doctor, harnessParity, audit, retract,
  answer, ownerQuestions, modules, modulesAdmin, agents, skills,
  mcpServer, web, capture, recall, webhook, approvals, secrets, and
  memory migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota knowledge list`,
  `kota knowledge show`, `kota knowledge search`, `kota knowledge
  add`, `kota knowledge remove`, `kota knowledge reindex`),
  daemon-up vs daemon-down branching, and exit-code semantics all
  continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  knowledge module's existing CLI rendering hooks are not part of
  this refactor.

## Done When

- `src/modules/knowledge/client.ts` exists and declares
  `KnowledgeClient`, `KnowledgeScope`, `KnowledgeWritableScope`,
  `KnowledgeListFilter`, `KnowledgeListResult`, `KnowledgeShowResult`,
  `KnowledgeSearchFilter`, `KnowledgeSearchResult`,
  `KnowledgeAddOptions`, `KnowledgeAddResult`,
  `KnowledgeDeleteResult`, and `KnowledgeReindexResult`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `KnowledgeClient` from this module.
- `src/modules/knowledge/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`.
- `src/modules/knowledge/index.ts` imports `KnowledgeClient` from
  `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `knowledge`-specific code: no `listKnowledgeHttp`,
  `showKnowledgeHttp`, `searchKnowledgeHttp`, `addKnowledgeHttp`,
  `deleteKnowledgeHttp`, `reindexKnowledgeHttp`; no inline
  `knowledge: { ... }` closure on the core-side stub builder; no
  `KnowledgeAddOptions` / `KnowledgeAddResult` /
  `KnowledgeDeleteResult` / `KnowledgeListFilter` /
  `KnowledgeListResult` / `KnowledgeReindexResult` /
  `KnowledgeSearchFilter` / `KnowledgeSearchResult` /
  `KnowledgeShowResult` imports; and no other
  knowledge-namespace-specific helpers.
- `src/modules/knowledge/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET list with the
  multi-key URLSearchParams shape, the GET show with
  `encodeURIComponent` round-trip and the `null`-on-404 → `{ found:
  false }` collapse, the GET search threading the multi-key
  URLSearchParams shape through both the keyword and `semantic: true`
  filter shapes, the POST add with body pass-through, the DELETE
  per-entry with `encodeURIComponent` round-trip and the
  `null`-on-404 → `not_found` collapse, the POST reindex, per-arm
  `KnowledgeSearchResult` decoding, per-arm `KnowledgeShowResult`
  decoding, per-arm `KnowledgeDeleteResult` decoding,
  `KnowledgeReindexResult` pass-through decoding, coverage success
  when the contribution is supplied, and coverage failure when it is
  removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"knowledge"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `knowledge` handler whose six methods return the placeholder shapes
  in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `KnowledgeListFilter` / `KnowledgeListResult` /
  `KnowledgeShowResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeAddOptions` /
  `KnowledgeAddResult` / `KnowledgeDeleteResult` /
  `KnowledgeReindexResult` / `KnowledgeScope` /
  `KnowledgeWritableScope` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`knowledge-daemon-up.txt` / `knowledge-daemon-down.txt`)
  demonstrate parity for one read (`kota knowledge list`) and one
  mutation (`kota knowledge add <title> <content>` followed by
  `kota knowledge remove <id>` against synthetic entries) showing the
  pre/post output is identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T02-28-32-229Z-explorer-4ygj24/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twenty orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the memory migration):

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
  (`excerpt → content`, `tags` dropped, `limit` slicing) and the first
  `semantic_unavailable` discriminated-union arm wired through
  `requestStrict<T>`.

`knowledge` is the next-cleanest multi-method namespace with six short
HTTP wire calls (GET / GET-with-path-id / GET-with-query / POST /
DELETE-with-path-id / POST) covering its complete daemon contract —
the natural next pilot in the cluster that began with the
ownerQuestions, agents, capture, approvals, and memory migrations. It
extends the pattern in three axes the prior pilots did not exercise:
(a) the first migration to surface the `semantic_unavailable`
discriminated-union arm wired through `requestStrict<T>` for a
multi-key URLSearchParams filter (six optional keys vs memory's four),
(b) the first migration carrying both a `{ found: true; entry } | {
found: false }` show-arm and a `{ ok: true } | { ok: false; reason:
"not_found" }` delete-arm in the same namespace threading both
through `request<T>`, and (c) the first migration whose contract
surfaces a provider type (`KnowledgeEntry` from
`#core/modules/provider-types.js`) verbatim through the daemon route
without a wire-shape transformation, validating that the
`#core/modules/provider-types.js` import is the right boundary for
provider-typed entries imported from inside a module's `client.ts`.
This migration de-risks the upcoming history and repo-tasks namespace
migrations that share both the `semantic_unavailable` arm and the
multi-key URLSearchParams filter shape, plus the upcoming sessions
migration that shares the `KnowledgeEntry`-style provider-typed-entry
pattern with `InteractiveSession`. It is needed under every chunking
answer the owner can pick on the parent task (a/b/c/d/unblock): the
knowledge namespace migrates exactly once regardless of whether the
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
  `knowledgeModule`, the in-module import shift in `index.ts`, the
  removed `listKnowledgeHttp` / `showKnowledgeHttp` /
  `searchKnowledgeHttp` / `addKnowledgeHttp` / `deleteKnowledgeHttp` /
  `reindexKnowledgeHttp` plus inline closure plus imports from
  `src/core/server/daemon-client.ts`, and the new daemon-side unit
  test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~70-line and ~110-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`knowledge-daemon-up.txt` / `knowledge-daemon-down.txt`)
  exercising one read (`kota knowledge list`) and one mutation
  (`kota knowledge add <title> <content>` then `kota knowledge remove
  <id>` against synthetic entries) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `KnowledgeListFilter` / `KnowledgeListResult` /
  `KnowledgeShowResult` / `KnowledgeSearchFilter` /
  `KnowledgeSearchResult` / `KnowledgeAddOptions` /
  `KnowledgeAddResult` / `KnowledgeDeleteResult` /
  `KnowledgeReindexResult` / `KnowledgeScope` /
  `KnowledgeWritableScope` declaration in `src/core/server/`.
