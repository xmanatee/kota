---
id: task-migrate-the-memory-kotaclient-namespace-end-to-end
title: Migrate the memory KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move MemoryClient interface and the MemoryListEntry/MemoryListResult/MemoryAddResult/MemoryDeleteResult/MemorySearchFilter/MemorySearchResult/MemoryReindexResult types from src/core/server/kota-client.ts into src/modules/memory/client.ts; add a daemonClient(link) factory to the memory module that wires GET /api/memory, POST /api/memory, DELETE /api/memory/:id, GET /api/memory/search, POST /api/memory/reindex through the typed DaemonTransport; remove listMemoryHttp/addMemoryHttp/deleteMemoryHttp/searchMemoryHttp/reindexMemoryHttp and the inline memory handler closure (with its excerpt-to-content shape transformation) from src/core/server/daemon-client.ts.
created_at: 2026-05-05T01:54:29.391Z
updated_at: 2026-05-05T01:54:29.391Z
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
and the secrets migration (`5841c7f0`, 2026-05-05) have validated the
`daemonClient(link)` foundation pattern by moving seventeen namespaces
out of `src/core/server/kota-client.ts` and `src/core/server/daemon-
client.ts` into their owning modules. 10 namespaces still have their
TypeScript shape and daemon-side wire code centralized in those two
files (`kota-client.ts` is 1003 lines, `daemon-client.ts` is 1651
lines, both still well over the 300-line guideline).

The next-cleanest namespace that fits the same multi-method end-to-end
shape is `memory`:

- 5 methods (`list(limit?)`, `add(content, tags?)`, `delete(id)`,
  `search(query, filter?)`, `reindex()`) — the same shape as the
  knowledge / history / repo-tasks store-CLI cluster, with the
  shared semantic-search-or-keyword-fallback contract.
- Already owned by a dedicated module under `src/modules/memory/` with
  its own `localClient(ctx)` factory (`index.ts` lines 43–97), control
  routes (`memoryRoutes()` registered against the daemon at `/api/memory`,
  `/api/memory/search`, `/api/memory/reindex`, and `/api/memory/:id`
  GET/DELETE/PATCH in `routes.ts`), and CLI (`registerMemoryCommands`
  in `cli.ts`).
- ~40 lines of namespace-owned types in `kota-client.ts` (lines 175–213):
  - `MemoryListEntry` (lines 176–180, 5 lines): the masked `{ id,
    created, content }` per-entry shape.
  - `MemoryListResult` (lines 182–184, 3 lines): the `{ entries }`
    aggregate result.
  - `MemoryAddResult` (line 187): the `{ id }` add-result shape.
  - `MemoryDeleteResult` (lines 190–192, 3 lines): the two-arm
    `{ ok: true } | { ok: false; reason: "not_found" }` discriminated
    union.
  - `MemorySearchFilter` (lines 195–200, 6 lines): the
    `{ tag?, since?, semantic?, limit? }` query-string filter.
  - `MemorySearchResult` (lines 208–210, 3 lines): the two-arm
    `{ ok: true; entries: MemoryListEntry[] } | { ok: false; reason:
    "semantic_unavailable" }` discriminated union.
  - `MemoryReindexResult` (line 213): the `ReindexResult` alias
    surfaced verbatim from the provider.
  - `MemoryClient` (lines 576–583, 8 lines).
  - The supporting doc comments (lines 175, 186, 189, 194, 202–207,
    212, 567–575).
- ~85 lines of wire code in `daemon-client.ts` —
  `addMemoryHttp` (lines 632–648, 17 lines),
  `deleteMemoryHttp` (lines 650–664, 15 lines),
  `searchMemoryHttp` (lines 666–689, 24 lines),
  `reindexMemoryHttp` (lines 691–703, 13 lines),
  `listMemoryHttp` (lines 888–900, 13 lines),
  plus the inline `memory: { list, add, delete, search, reindex }`
  closure on the central handler builder (lines 1221–1238, 18 lines)
  whose `list` arm carries an excerpt-to-content shape transformation
  the contract surface owns.
- The wire code today issues GET `/api/memory`, POST `/api/memory`,
  DELETE `/api/memory/:id`, GET `/api/memory/search?q=…&tag=…&since=…&semantic=…&limit=…`,
  and POST `/api/memory/reindex` through `fetchWithTimeout` plus
  `transport.authHeaders()` directly; the factory body collapses into
  five strict requests once the typed `DaemonTransport` link supplies
  the standard JSON-decode path.
- The memory module's local consumer (`index.ts`) currently imports
  `MemoryClient` from `#core/server/kota-client.js`. After the
  migration this import points at the module-local `client.ts`,
  mirroring every prior namespace migration.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same shape
as the prior pilots. The shape extends the pattern in two new
dimensions: (a) the first migration whose closure carries an explicit
**daemon-wire-to-client-contract shape transformation** (the daemon
route emits `{ id, tags, created, excerpt }[]` with `excerpt =
content.slice(0, 200).replace(/\s+/g, " ").trim()` and the client
contract collapses that into `{ id, created, content }[]` by mapping
`excerpt → content` and dropping `tags`); the new factory must
preserve that transformation byte-for-byte while owning it inside the
memory module instead of in the central closure, and (b) the first
migration to surface the **`semantic_unavailable` discriminated-union
arm** wired through `requestStrict<T>` for both the search arm and
its keyword fallback path — the prior search-bearing migrations
(skills, capture, recall) used different result shapes and did not
exercise the shared `{ ok: true; entries: ... } | { ok: false;
reason: "semantic_unavailable" }` contract that knowledge / history
/ repo-tasks all share.

## Desired Outcome

`memory` is the eighteenth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `MemoryClient`, `MemoryListEntry`, `MemoryListResult`,
  `MemoryAddResult`, `MemoryDeleteResult`, `MemorySearchFilter`,
  `MemorySearchResult`, and `MemoryReindexResult` live in
  `src/modules/memory/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `MemoryClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/memory/index.ts` adds a `daemonClient(link)` factory
  parallel to its existing `localClient(ctx)` factory. The factory
  returns `{ memory: MemoryClient }` whose five methods route through:
  - `list(limit)` → `link.requestStrict<{ entries: { id: string;
    tags: string[]; created: string; excerpt: string }[] }>("GET",
    "/api/memory")` then collapsing the daemon-wire entries into the
    `MemoryListResult` shape by mapping `excerpt → content`, dropping
    `tags`, and slicing by `limit ?? Number.POSITIVE_INFINITY` to
    preserve today's central-closure behavior byte-for-byte.
  - `add(content, tags)` → `link.requestStrict<{ id: string }>("POST",
    "/api/memory", { content, tags: tags ?? [] })` collapsing into
    `{ id }`.
  - `delete(id)` → `link.request<{ deleted: string }>("DELETE",
    `/api/memory/${encodeURIComponent(id)}`)` then collapsing `null`
    (404) into `{ ok: false, reason: "not_found" }` and a non-null
    result into `{ ok: true }`.
  - `search(query, filter)` → builds the same
    `URLSearchParams` shape today's `searchMemoryHttp` builds (`q=…`,
    optional `tag`, `since`, `semantic=true`, `limit`) and calls
    `link.requestStrict<MemorySearchResult>("GET",
    `/api/memory/search?${params.toString()}`)`. The daemon route
    emits the discriminated union directly (`{ ok: true; entries }`
    or `{ ok: false; reason: "semantic_unavailable" }`) so no
    additional collapse is needed.
  - `reindex()` → `link.requestStrict<MemoryReindexResult>("POST",
    "/api/memory/reindex")`.

  matching today's `listMemoryHttp` / `addMemoryHttp` /
  `deleteMemoryHttp` / `searchMemoryHttp` / `reindexMemoryHttp` URL
  paths, HTTP verbs, query-string contracts, and JSON-body contracts
  byte-for-byte, including the `MemoryListEntry` shape transformation
  the central closure owns today.
- `src/core/server/daemon-client.ts` no longer carries
  `listMemoryHttp`, `addMemoryHttp`, `deleteMemoryHttp`,
  `searchMemoryHttp`, `reindexMemoryHttp`, the inline `memory: { list,
  add, delete, search, reindex }` closure on the core-side stub
  builder, the `MemoryAddResult` / `MemoryDeleteResult` /
  `MemoryListEntry` / `MemoryReindexResult` / `MemorySearchFilter` /
  `MemorySearchResult` imports from `./kota-client.js`, or any other
  memory-namespace-specific helpers. Module-contributed handlers
  replace all of these the same way every prior migration did.
- `src/modules/memory/index.ts` updates its import of `MemoryClient`
  from `#core/server/kota-client.js` to the module-local `./client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/memory/daemon-client.test.ts`) exercises the wire
  shape against a recording `DaemonTransport`, mirroring
  `src/modules/secrets/daemon-client.test.ts`,
  `src/modules/webhook/daemon-client.test.ts`,
  `src/modules/approval-queue/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `memory`, (2) `list(limit)` routes through `requestStrict<T>` with
  method `GET`, path `/api/memory`, and an undefined body — including
  one call with `limit` undefined and one with `limit: 2` against a
  recorded multi-entry payload to pin both the slicing behavior and
  the `excerpt → content` mapping with `tags` dropped, (3) `add`
  routes through `requestStrict<T>` with method `POST`, path
  `/api/memory`, and body `{ content, tags }` — including one call
  with `tags` undefined collapsing to `[]` and one call with a
  multi-tag array preserved verbatim, (4) `delete(id)` routes through
  `request<T>` with method `DELETE`, path
  `/api/memory/${encodeURIComponent(id)}`, and an undefined body —
  including an id containing `%`, `/`, and a space to pin the path
  encoding, plus a `null` (404) collapse into
  `{ ok: false, reason: "not_found" }` and a non-null collapse into
  `{ ok: true }`, (5) `search(query, filter)` routes through
  `requestStrict<T>` with method `GET`, path
  `/api/memory/search?${params}`, and an undefined body — including
  one call with no filter (only `q=…`), one call with `{ tag, since,
  limit }` to pin the optional-key inclusion order matching today's
  `searchMemoryHttp`, and one call with `semantic: true` to pin
  `semantic=true` inclusion, (6) `reindex()` routes through
  `requestStrict<T>` with method `POST`, path `/api/memory/reindex`,
  and an undefined body, (7) `MemorySearchResult` decodes correctly
  through `requestStrict<T>` for both arms (a `200` `{ ok: true;
  entries: [...] }` response collapses unchanged and a `200`
  `{ ok: false; reason: "semantic_unavailable" }` response collapses
  unchanged), (8) `MemoryDeleteResult` arms decode correctly: a
  `200` non-null response collapses into `{ ok: true }` and a `null`
  (404) response collapses into `{ ok: false, reason: "not_found" }`,
  (9) `MemoryReindexResult` decodes correctly through
  `requestStrict<T>` (the provider's `ReindexResult` shape passes
  through unchanged), (10) the assembly satisfies coverage with the
  memory contribution, and (11) the assembly throws naming "memory"
  when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"memory"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `memory` handler returning `{ entries: [] }` from `list()`,
  `{ id: "stub" }` from `add()`, `{ ok: true }` from `delete()`,
  `{ ok: true, entries: [] }` from `search()`, and the provider's
  reindex-result placeholder shape from `reindex()` so tests that
  build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/api/memory`, `/api/memory/search`,
  `/api/memory/reindex`, and `/api/memory/:id` routes keep their HTTP
  verbs (GET / POST / DELETE / GET / POST), query-string contracts
  (`?q=…&tag=…&since=…&semantic=…&limit=…` on search), and JSON-body
  contracts (`{ content, tags }` on POST) exactly as parsed in
  `src/modules/memory/routes.ts`. The CLI-facing `kota memory`
  subcommands and the `memory` agent tool are unrelated to this
  migration and must not be touched. The PATCH `/api/memory/:id`
  route (`handleUpdateMemory`) and the GET `/api/memory/:id` route
  (`handleGetMemory`) currently exist in `routes.ts` for the CLI
  surfaces but are not part of the `MemoryClient` contract and stay
  unchanged.
- The daemon-side handler uses `link.requestStrict<T>` and
  `link.request<T>` through the typed `DaemonTransport`. It does not
  reach into `node:http`, the bearer token, or
  `.kota/daemon-control.json`. The HTTP method and path stay byte-for-
  byte identical to today's wire code, including
  `encodeURIComponent(id)` on the per-entry DELETE path and the
  `URLSearchParams` insertion order on the search path so any embedded
  slashes, percents, or spaces in the entry id continue to round-trip
  safely.
- The `MemoryListEntry` shape transformation (`excerpt → content`,
  `tags` dropped, slice by `limit`) lives inside the new
  `daemonClient(link)` factory, not on the daemon route. The route's
  daemon-wire shape (`{ id, tags, created, excerpt }`) does not
  change; the contract surface (`{ id, created, content }`) does not
  change; the transformation moves with the namespace into the owning
  module.
- No legacy or compatibility surface. Delete `listMemoryHttp`,
  `addMemoryHttp`, `deleteMemoryHttp`, `searchMemoryHttp`,
  `reindexMemoryHttp`, the inline closure, the central type
  declarations, and the `MemoryAddResult` / `MemoryDeleteResult` /
  `MemoryListEntry` / `MemoryReindexResult` / `MemorySearchFilter` /
  `MemorySearchResult` imports at the migration's edges as it
  completes; do not leave shims. The in-module import shift in
  `index.ts` from `#core/server/kota-client.js` to `./client.js` is a
  hard cutover, not a parallel re-export.
- The `MemoryDeleteResult` two-arm shape (`{ ok: true } | { ok: false;
  reason: "not_found" }`) is preserved exactly. The
  `MemorySearchResult` two-arm shape (`{ ok: true; entries:
  MemoryListEntry[] } | { ok: false; reason: "semantic_unavailable" }`)
  is preserved exactly. The `MemoryListResult` shape (`{ entries:
  MemoryListEntry[] }`) is preserved exactly. The `MemoryAddResult`
  shape (`{ id: string }`) is preserved exactly. The
  `MemoryReindexResult` alias to the provider's `ReindexResult` is
  preserved exactly.
- The daemon-up branch's transport behavior preserves today's
  semantics: `delete` collapses any non-`200` response into the
  `not_found` arm to match today's silent fallthrough on 404; `list`,
  `add`, `search`, and `reindex` propagate transport errors through
  `requestStrict<T>` (today's central closures already throw on
  non-`ok` responses with the JSON `error` body, matching
  `requestStrict<T>`'s contract).
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `MemoryListEntry` / `MemoryListResult` /
  `MemoryAddResult` / `MemoryDeleteResult` / `MemorySearchFilter` /
  `MemorySearchResult` / `MemoryReindexResult` declarations in
  `src/core/server/`. Existing assertions for the doctor,
  harnessParity, audit, retract, answer, ownerQuestions, modules,
  modulesAdmin, agents, skills, mcpServer, web, capture, recall,
  webhook, approvals, and secrets migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota memory list`, `kota memory
  add`, `kota memory search`, `kota memory remove`, `kota memory
  reindex`), daemon-up vs daemon-down branching, and exit-code
  semantics all continue to behave identically.
- Output continues to flow through `src/modules/rendering`. The
  memory module's existing CLI rendering hooks are not part of this
  refactor.

## Done When

- `src/modules/memory/client.ts` exists and declares `MemoryClient`,
  `MemoryListEntry`, `MemoryListResult`, `MemoryAddResult`,
  `MemoryDeleteResult`, `MemorySearchFilter`, `MemorySearchResult`,
  and `MemoryReindexResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `MemoryClient` from this
  module.
- `src/modules/memory/index.ts` exposes `daemonClient(link)` parallel
  to `localClient(ctx)`.
- `src/modules/memory/index.ts` imports `MemoryClient` from
  `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  `memory`-specific code: no `listMemoryHttp`, `addMemoryHttp`,
  `deleteMemoryHttp`, `searchMemoryHttp`, `reindexMemoryHttp`; no
  inline `memory: { ... }` closure on the core-side stub builder; no
  `MemoryAddResult` / `MemoryDeleteResult` / `MemoryListEntry` /
  `MemoryReindexResult` / `MemorySearchFilter` / `MemorySearchResult`
  imports; and no other memory-namespace-specific helpers.
- `src/modules/memory/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, wire-shape assertions covering the GET list with the
  `excerpt → content` mapping and `limit` slicing, the POST add with
  method/path/body assertions threading both the undefined and
  multi-tag cases, the DELETE per-entry with `encodeURIComponent(id)`
  round-trip on an id with reserved characters and the
  `null`-on-404 → `not_found` collapse, the GET search threading the
  `URLSearchParams` insertion order through both the keyword and
  `semantic: true` filter shapes, the POST reindex, per-arm
  `MemorySearchResult` decoding (both the `ok: true` entries arm
  and the `ok: false; reason: "semantic_unavailable"` arm), per-arm
  `MemoryDeleteResult` decoding through the `null`-on-404 branch,
  `MemoryReindexResult` pass-through decoding, coverage success when
  the contribution is supplied, and coverage failure when it is
  removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"memory"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `memory` handler whose five methods return the placeholder shapes
  in `## Desired Outcome` above.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `MemoryListEntry` / `MemoryListResult` / `MemoryAddResult` /
  `MemoryDeleteResult` / `MemorySearchFilter` / `MemorySearchResult`
  / `MemoryReindexResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`memory-daemon-up.txt` / `memory-daemon-down.txt`) demonstrate
  parity for one read (`kota memory list`) and one mutation
  (`kota memory add <content>` followed by `kota memory remove
  <id>` against synthetic entries) showing the pre/post output is
  identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T01-51-46-657Z-explorer-45xowl/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Nineteen orthogonal preludes have already landed (the foundation /
pilot / migration commits plus the secrets migration):

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

`memory` is the next-cleanest multi-method namespace with five short
HTTP wire calls (GET / POST / DELETE / GET / POST) covering its
complete daemon contract — the natural next pilot in the cluster
that began with the ownerQuestions, agents, capture, and approvals
migrations. It extends the pattern in two axes the prior pilots did
not exercise: (a) the first migration whose closure carries an
explicit **daemon-wire-to-client-contract shape transformation** (the
daemon route emits `{ id, tags, created, excerpt }` and the client
contract collapses that into `{ id, created, content }` by mapping
`excerpt → content`, dropping `tags`, and slicing by `limit`); the
new factory must preserve that transformation byte-for-byte while
owning it inside the memory module instead of in the central closure,
and (b) the first migration to surface the **`semantic_unavailable`
discriminated-union arm** wired through `requestStrict<T>` for the
search arm — the prior search-bearing migrations (skills, capture,
recall) used different result shapes and did not exercise the shared
`{ ok: true; entries: ... } | { ok: false; reason:
"semantic_unavailable" }` contract that knowledge / history /
repo-tasks all share, so this migration also de-risks the upcoming
knowledge / history / repo-tasks namespace migrations by establishing
the `semantic_unavailable` precedent. It is needed under every
chunking answer the owner can pick on the parent task
(a/b/c/d/unblock): the memory namespace migrates exactly once
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
  `memoryModule`, the in-module import shift in `index.ts`, the
  removed `listMemoryHttp` / `addMemoryHttp` / `deleteMemoryHttp` /
  `searchMemoryHttp` / `reindexMemoryHttp` plus inline closure plus
  imports from `src/core/server/daemon-client.ts`, and the new
  daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~40-line and ~85-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`memory-daemon-up.txt` / `memory-daemon-down.txt`) exercising one
  read (`kota memory list`) and one mutation (`kota memory add
  <content>` then `kota memory remove <id>` against synthetic
  entries) with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `MemoryListEntry` / `MemoryListResult` / `MemoryAddResult` /
  `MemoryDeleteResult` / `MemorySearchFilter` / `MemorySearchResult`
  / `MemoryReindexResult` declaration in `src/core/server/`.
