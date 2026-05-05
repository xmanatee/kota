---
id: task-migrate-the-tasks-kotaclient-namespace-end-to-end
title: Migrate the tasks KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move RepoTasksClient and its 13 supporting types (RepoTaskState/ListEntry/ListResult/ShowResult/MoveResult/Priority/CreateOptions/CreateResult/CaptureResult/GcOptions/GcResult/SearchFilter/SearchResult/ReindexResult) from src/core/server/kota-client.ts into src/modules/repo-tasks/client.ts; add a daemonClient(link) factory to src/modules/repo-tasks/index.ts that contributes the tasks namespace handler routing GET /api/tasks, GET /api/tasks/<id>, PATCH /api/tasks/<id>/move, POST /api/tasks/normalized, POST /api/tasks/capture, POST /api/tasks/gc, GET /tasks/search, POST /tasks/reindex through the typed DaemonTransport; delete the inline tasks closure plus the 8 namespace-only helpers (showTaskHttp, moveTaskHttp, createTaskHttp, captureTaskHttp, gcTasksHttp, searchTasksHttp, reindexTasksHttp, listTasksHttp) from src/core/server/daemon-client.ts; extend STUB_OMITTED_NAMESPACES and buildMigratedNamespaceTestStubs() with the tasks stub.
created_at: 2026-05-05T06:51:55.284Z
updated_at: 2026-05-05T07:19:06.180Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03) and twenty-four follow-on
migrations through `config` (`76e1c745`, 2026-05-05) have validated the
`daemonClient(link)` foundation pattern by moving twenty-five namespaces
out of `src/core/server/kota-client.ts` and `src/core/server/daemon-
client.ts` into their owning modules. Two namespaces remain centralized
in those two files (`kota-client.ts` is 500 lines, `daemon-client.ts` is
882 lines, both still over the 300-line guideline): `tasks` and
`workflow`.

The cleaner next migration is `tasks`:

- 8 methods (`list(states)`, `show(id)`, `move(id, toState)`,
  `create(options)`, `capture(title)`, `gc(options)`, `search(query,
  filter)`, `reindex()`) — owned by the `src/modules/repo-tasks/`
  module, which already exposes a `localClient(ctx)` factory at
  `src/modules/repo-tasks/index.ts:67-138` returning a complete
  `RepoTasksClient` backed by `listTasksForStates`, `showTask`,
  `moveTaskById`, `createNormalizedTask`, `captureInboxTask`,
  `gcTerminalTasks`, the active `RepoTasksProvider`, and the
  `RepoTasksDefaultStore` substring fallback.
- All 8 namespace-only helpers (`showTaskHttp`, `moveTaskHttp`,
  `createTaskHttp`, `captureTaskHttp`, `gcTasksHttp`, `searchTasksHttp`,
  `reindexTasksHttp`, `listTasksHttp`) on `daemon-client.ts:102-283`
  are consumed only by the inline `tasks` closure on
  `buildCoreStubDaemonClientHandlers` (lines 570-600). No
  non-namespace direct method on `DaemonControlClient` wraps them. They
  can be deleted in this migration with no caller fallout — the same
  shape as `config`, `doctor`, and the bulk of the prior 25 migrations
  (and unlike `workflow`, whose 12 helpers also back
  `DaemonControlClient.pause()` / `resume()` / `abort()` / `reload()` /
  `enableWorkflow()` / `disableWorkflow()` / `trigger()` / `abortRun()`
  / `cancelRun()` / `listWorkflowRuns()` / `getWorkflowRun()` /
  `getWorkflowStatus()` / `getWorkflowDefinitions()` direct methods,
  whose decoupling is already tracked separately).
- ~110 lines of namespace-owned types in `kota-client.ts` (lines
  67-177 plus the `RepoTasksClient` interface at 384-407): `RepoTaskState`,
  `RepoTaskListEntry`, `RepoTaskListResult`, `RepoTaskShowResult`,
  `RepoTaskMoveResult`, `RepoTaskPriority`, `RepoTaskCreateOptions`,
  `RepoTaskCreateResult`, `RepoTaskCaptureResult`, `RepoTaskGcOptions`,
  `RepoTaskGcResult`, `RepoTaskSearchFilter`, `RepoTaskSearchResult`,
  `RepoTaskReindexResult`, plus the `RepoTasksClient` interface itself.
- ~210 lines of namespace-only helpers plus inline closure in
  `daemon-client.ts`:
  - `showTaskHttp` (lines 102-117, 16 lines): GET
    `/api/tasks/<encodeURIComponent(id)>`, returns `{ found: false }`
    on 404 and `{ found: true, state, content }` on success.
  - `moveTaskHttp` (lines 119-156, 38 lines): PATCH
    `/api/tasks/<id>/move` with body `{ state: toState }`; returns
    `{ ok: false, reason: "not_found" }` on 404,
    `{ ok: false, reason: "already_in_state", state }` on 409, and
    `{ ok: true, id, fromState, toState, path, previousPath }` on
    success.
  - `createTaskHttp` (lines 158-182, 25 lines): POST
    `/api/tasks/normalized` with the `RepoTaskCreateOptions` body;
    returns `{ ok: false, reason: "already_exists" | "invalid_slug",
    message }` on 409/400 and `{ ok: true, id, path }` on success.
  - `captureTaskHttp` (lines 184-207, 24 lines): POST
    `/api/tasks/capture` with body `{ title }`; same conflict and
    success arms as `createTaskHttp`.
  - `gcTasksHttp` (lines 209-223, 15 lines): POST `/api/tasks/gc` with
    the `RepoTaskGcOptions` body; throws on `!ok`, returns the body
    verbatim as `RepoTaskGcResult` on success.
  - `searchTasksHttp` (lines 225-246, 22 lines): GET
    `/tasks/search?q=<query>&...` with `semantic`, `limit`, `state`
    filters; throws on `!ok`, returns the body verbatim as
    `RepoTaskSearchResult` on success.
  - `reindexTasksHttp` (lines 248-260, 13 lines): POST
    `/tasks/reindex`; throws on `!ok`, returns the body verbatim as
    `RepoTaskReindexResult`.
  - `listTasksHttp` (lines 262-283, 22 lines): GET `/api/tasks`,
    soft-fails — returns `null` on transport error or non-ok response
    so the inline `tasks.list` closure can fall through to an empty
    list. Note the asymmetry with the other 7 helpers: this one
    swallows errors instead of throwing.
  - The inline `tasks: { list, show, move, create, capture, gc,
    search, reindex }` closure on `buildCoreStubDaemonClientHandlers`
    (lines 570-600, 31 lines). The `list` arm filters by state
    in-process: it skips terminal states (`done`, `dropped`) and
    defaults to `REPO_TASK_OPEN_STATES` when the caller passes no
    states. That state-filter mapping is the only non-trivial reshape
    in the closure.
  - The 11 task type imports `RepoTaskCaptureResult`,
    `RepoTaskCreateOptions`, `RepoTaskCreateResult`, `RepoTaskGcOptions`,
    `RepoTaskGcResult`, `RepoTaskListEntry`, `RepoTaskMoveResult`,
    `RepoTaskReindexResult`, `RepoTaskSearchFilter`,
    `RepoTaskSearchResult`, `RepoTaskShowResult`, `RepoTaskState` (and
    the `RepoTasksClient` import is already indirect through
    `KotaClient`) at the top of `daemon-client.ts`. After the
    migration, daemon-client.ts no longer imports any task types.
  - The local `REPO_TASK_OPEN_STATES` constant (lines 38-43) duplicates
    the one in `src/modules/repo-tasks/index.ts:35-40`. Deleting the
    inline `tasks` closure removes the only consumer in
    daemon-client.ts and the constant goes with it.
- The 8 helpers are consumed only by the inline `tasks` closure —
  there are no non-namespace direct methods on `DaemonControlClient`
  that wrap them. They can be deleted in this migration with no caller
  fallout.
- The wire code today issues:
  - `list(states)` → GET `/api/tasks`. Soft-fails to `null` on
    transport error or `!ok`. Returns `{ counts, tasks: Record<state,
    [...] >}` on success; the inline closure flattens this into
    `RepoTaskListEntry[]` filtered to the caller's requested states
    (defaulting to `["backlog", "ready", "doing", "blocked"]` when
    none) and excluding `done` / `dropped`.
  - `show(id)` → GET `/api/tasks/<encodeURIComponent(id)>`. 404 →
    `{ found: false }`; non-ok throws daemon's `error` field; 200 →
    `{ found: true, state, content }`.
  - `move(id, toState)` → PATCH
    `/api/tasks/<encodeURIComponent(id)>/move` with body `{ state:
    toState }`. 404 → `{ ok: false, reason: "not_found" }`; 409
    → `{ ok: false, reason: "already_in_state", state }`; non-ok
    throws daemon's `error` field; 200 → `{ ok: true, id, fromState,
    toState, path, previousPath }`.
  - `create(options)` → POST `/api/tasks/normalized` with the full
    `RepoTaskCreateOptions` body. 409 → `{ ok: false, reason:
    "already_exists", message }`; 400 → `{ ok: false, reason:
    "invalid_slug", message }`; non-ok throws; 200 → `{ ok: true,
    id, path }`.
  - `capture(title)` → POST `/api/tasks/capture` with body `{ title }`.
    Same conflict and success arms as `create`.
  - `gc(options)` → POST `/api/tasks/gc` with the `RepoTaskGcOptions`
    body (or `{}` when omitted). Non-ok throws; 200 returns the
    `RepoTaskGcResult` body verbatim.
  - `search(query, filter)` → GET `/tasks/search?q=<query>` with
    `semantic=false`, `limit=<n>`, and one or more `state=<s>` query
    params from `filter`. Non-ok throws; 200 returns the
    `RepoTaskSearchResult` body verbatim.
  - `reindex()` → POST `/tasks/reindex`. Non-ok throws; 200 returns the
    `RepoTaskReindexResult` body verbatim.
- The `src/modules/repo-tasks/index.ts` module already imports
  `RepoTaskListEntry`, `RepoTaskSearchResult`, `RepoTaskState`, and
  `RepoTasksClient` from `#core/server/kota-client.js` (lines 17-22).
  After the migration, the new `client.ts` declares these types
  alongside the local factory; `index.ts` imports them from
  `./client.js` instead, same as `daemon-ops/index.ts` imports
  `DaemonOpsClient` and `config/index.ts` imports `ConfigClient` from
  their local `./client.js`.

Two non-trivial reshapes specific to this migration relative to prior
pilots:

- The state-filter logic in `tasks.list` (skip terminal states; default
  to `REPO_TASK_OPEN_STATES` when no states given) lives inside the
  closure on the daemon side today. It needs to move into the new
  `daemonClient(link)` factory verbatim — the daemon's `/api/tasks`
  response shape is a state-keyed `Record<state, [...] >`, not a flat
  list, and the closure does the flattening. Local-side
  `localClient.list` does its own state filtering against the
  filesystem; the daemon-side replica must keep matching that contract.
- `listTasksHttp` is the first migration target with a soft-fail helper
  (returns `null` on transport error). The new `daemonClient` factory
  must preserve that semantics — `tasks.list` returns `{ tasks: [] }`
  on transport failure, not a thrown error — to preserve compatibility
  with `kota task` daemon-up behavior when the daemon's `/api/tasks`
  endpoint fails mid-call. The other 7 helpers throw on non-ok and the
  factory closure must throw too (all daemon-up CLI subcommands today
  surface those throws verbatim).

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes. After this
migration lands, only `workflow` remains centralized in
`src/core/server/`; that migration is larger and entangled with the
~12 non-namespace direct methods on `DaemonControlClient` already
tracked under the orthogonal-transport-decoupling task in `ready/` (or,
if that work has already landed, surfaceable as a single follow-up).

## Desired Outcome

`tasks` is the twenty-sixth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `RepoTasksClient` and its 13 result/option types live in
  `src/modules/repo-tasks/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports `RepoTasksClient`
  from `#modules/repo-tasks/client.js` instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist already
  covers the `server/kota-client.ts` exception; no allowlist edit is
  needed.
- `src/modules/repo-tasks/index.ts` adds a
  `daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) })`
  field on the `KotaModule` definition. The new
  `buildRepoTasksDaemonHandler(link): RepoTasksClient` factory returns
  the eight-method namespace handler whose methods route through:
  - `list(states)` → calls `link.fetchRaw("/api/tasks", { method:
    "GET" })`. On transport failure or `!ok` returns `{ tasks: [] }`
    (preserves the prior soft-fail). On success parses the
    `{ counts, tasks: Record<state, [...] >}` body, flattens entries
    matching the caller's requested states (defaulting to
    `["backlog", "ready", "doing", "blocked"]` when omitted), and
    skips terminal `done` / `dropped` states.
  - `show(id)` → calls `link.fetchRaw(\`/api/tasks/\${encodeURIComponent(id)}\`,
    { method: "GET" })`. On 404 returns `{ found: false }`. On `!ok`
    reads the daemon's `error` field and throws (matching today's
    `HTTP <status>` fallback). On success parses
    `{ state, content }` and returns `{ found: true, state, content }`.
  - `move(id, toState)` → calls
    `link.fetchRaw(\`/api/tasks/\${encodeURIComponent(id)}/move\`,
    { method: "PATCH", body: JSON.stringify({ state: toState }) })`
    with the JSON content-type header. On 404 returns `{ ok: false,
    reason: "not_found" }`; on 409 returns `{ ok: false, reason:
    "already_in_state", state }` (using the response body's `state`
    or falling back to `toState`); on other `!ok` throws daemon's
    `error`; on success parses and returns `{ ok: true, id,
    fromState, toState, path, previousPath }`.
  - `create(options)` → calls
    `link.fetchRaw("/api/tasks/normalized", { method: "POST", body:
    JSON.stringify(options) })` with the JSON content-type header.
    On 409 returns `{ ok: false, reason: "already_exists", message }`;
    on 400 returns `{ ok: false, reason: "invalid_slug", message }`;
    on other `!ok` throws daemon's `error`; on success parses and
    returns `{ ok: true, id, path }`.
  - `capture(title)` → calls `link.fetchRaw("/api/tasks/capture",
    { method: "POST", body: JSON.stringify({ title }) })`. Same
    conflict and success arms as `create`.
  - `gc(options)` → calls `link.fetchRaw("/api/tasks/gc", { method:
    "POST", body: JSON.stringify(options ?? {}) })`. On `!ok` throws
    daemon's `error`; on success returns the parsed
    `RepoTaskGcResult` body verbatim.
  - `search(query, filter)` → builds the query string with `q`,
    optional `semantic=false`, `limit=<n>`, and one or more
    `state=<s>` params, then calls
    `link.fetchRaw(\`/tasks/search?\${params.toString()}\`)`. On `!ok`
    throws daemon's `error`; on success returns the parsed
    `RepoTaskSearchResult` body verbatim.
  - `reindex()` → calls `link.fetchRaw("/tasks/reindex", { method:
    "POST" })`. On `!ok` throws daemon's `error`; on success returns
    the parsed `RepoTaskReindexResult` body verbatim.
- `src/core/server/daemon-client.ts` no longer carries the inline `tasks`
  closure on `buildCoreStubDaemonClientHandlers`, no longer carries the
  8 helpers (`showTaskHttp`, `moveTaskHttp`, `createTaskHttp`,
  `captureTaskHttp`, `gcTasksHttp`, `searchTasksHttp`,
  `reindexTasksHttp`, `listTasksHttp`), no longer imports the 11 task
  types from `kota-client.js`, and no longer carries the
  `REPO_TASK_OPEN_STATES` local constant. The file shrinks by
  ~210 lines.
- `src/core/server/kota-client.ts` no longer declares
  `RepoTaskState`, `RepoTaskListEntry`, `RepoTaskListResult`,
  `RepoTaskShowResult`, `RepoTaskMoveResult`, `RepoTaskPriority`,
  `RepoTaskCreateOptions`, `RepoTaskCreateResult`,
  `RepoTaskCaptureResult`, `RepoTaskGcOptions`, `RepoTaskGcResult`,
  `RepoTaskSearchFilter`, `RepoTaskSearchResult`,
  `RepoTaskReindexResult`, or the `RepoTasksClient` interface — only
  re-imports `RepoTasksClient` from `#modules/repo-tasks/client.js`
  for the aggregate `KotaClient` interface. The file shrinks by
  ~110 lines.
- `STUB_OMITTED_NAMESPACES` in
  `src/core/server/daemon-client.test.ts` gains `"tasks"`; the
  per-namespace closure-coverage check stops asserting that the core
  stub still ships a `tasks` closure (mirrors how
  `daemon-client.test.ts` already excludes the prior 25 migrated
  namespaces).
- `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` gains a `tasks` stub
  with no-op closures for every method (matching the pattern other
  migrated namespaces use; e.g. `list: async () => ({ tasks: [] })`,
  `show: async () => ({ found: false as const })`, `search: async ()
  => ({ ok: true as const, tasks: [] })`).
- All existing repo-task daemon-up CLI behaviors continue to work
  byte-for-byte:
  - `kota task list [--state ...]` populates from the daemon's
    `/api/tasks` endpoint with the same state filtering.
  - `kota task show <id>` produces the same body and the same
    `not found` exit on 404.
  - `kota task move <id> <state>` produces the same `moved`,
    `already in state`, and `not found` rendering.
  - `kota task create` and `kota task capture` produce the same
    conflict and validation messaging.
  - `kota task gc` produces the same archived/deleted summary.
  - `kota task search` produces the same ranked output for both the
    keyword and semantic paths.
  - `kota task reindex` produces the same `indexed`/`failed` summary.

## Constraints

- One mechanism. Do not add a second public client surface or a second
  module-contribution path — the daemon-side handler registers through
  the `daemonClient(link)` factory on `KotaModule`.
- Preserve the soft-fail semantics of `tasks.list`: a transport error
  or non-ok response from `/api/tasks` returns `{ tasks: [] }`, not a
  throw. All seven other methods throw on non-ok daemon responses
  (matching today's behavior).
- Preserve the in-process state filtering done by the inline closure
  today: skip terminal states (`done`, `dropped`); default to
  `["backlog", "ready", "doing", "blocked"]` when no states are given.
- Preserve the byte-for-byte URL paths and HTTP verbs the daemon serves:
  `GET /api/tasks`, `GET /api/tasks/<id>`, `PATCH /api/tasks/<id>/move`,
  `POST /api/tasks/normalized`, `POST /api/tasks/capture`,
  `POST /api/tasks/gc`, `GET /tasks/search`, `POST /tasks/reindex`.
  Do not change route paths, HTTP verbs, query-param shapes, or
  request/response body shapes — this is an internal refactor, not a
  protocol change.
- The new daemon-side factory composes against the `DaemonTransport`
  link's typed `request<T>` / `fetchRaw` / `authHeaders()` / `baseUrl`
  primitives. Do not pass through to `node:http`, the bearer token,
  or `.kota/daemon-control.json` directly — those stay inside
  `src/core/server/daemon-client.ts`.
- No legacy or compatibility shim. Delete the old centralized closure,
  helpers, type declarations, and `REPO_TASK_OPEN_STATES` constant in
  the same change; do not leave deprecation re-exports.
- The `src/core/server/kota-client-namespace-types-guard.test.ts` guard
  test continues to pass without modification — adding a new module
  with `client.ts` and removing the centralized declarations matches
  the existing invariant.

## Done When

- `RepoTasksClient` and its 13 supporting types live in
  `src/modules/repo-tasks/client.ts`. `src/core/server/kota-client.ts`
  imports `RepoTasksClient` from there and no longer declares the
  task-namespace types inline.
- `src/modules/repo-tasks/index.ts` declares
  `daemonClient: (link) => ({ tasks: buildRepoTasksDaemonHandler(link) })`
  on the `KotaModule` and exports a `buildRepoTasksDaemonHandler(link)`
  factory returning a `RepoTasksClient` whose 8 methods preserve the
  byte-for-byte URL paths, verbs, and reshape contracts above.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `tasks` closure, the 8 task-namespace helpers, the 11 task-type
  imports, or the local `REPO_TASK_OPEN_STATES` constant. The file
  shrinks by ~210 lines from 882 toward the 300-line guideline.
- `src/core/server/kota-client.ts` no longer declares the 13
  task-namespace types or the `RepoTasksClient` interface. The file
  shrinks by ~110 lines from 500 toward the 300-line guideline.
- `STUB_OMITTED_NAMESPACES` in `daemon-client.test.ts` includes
  `"tasks"`; `buildMigratedNamespaceTestStubs()` in
  `daemon-client-test-stubs.ts` ships a `tasks` no-op stub.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`.kota/runs/<run-id>/transcript.txt`) demonstrate parity for at
  least one read (`kota task list` or `kota task show <id>`) and one
  mutation (`kota task move <id> ready` or `kota task capture
  "<title>"`) on each of the two transports.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T06-51-55-284Z-explorer-mdvi4q/` after the
config namespace migrated (commit `76e1c745`, 2026-05-05). Two
namespaces (`tasks`, `workflow`) remain centralized; `tasks` is the
cleaner next pilot because all 8 of its helpers are consumed only by
the inline closure (no `DaemonControlClient` direct method shares
them), matching the `config` / `doctor` shape rather than the
`daemonOps` partial-asymmetry shape. After this migration lands,
`workflow` is the last namespace; its migration is entangled with the
~12 non-namespace direct methods on `DaemonControlClient` already
tracked separately and can land independently.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives. This is the twenty-sixth per-namespace
follow-up of the parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` in
`blocked/` (decompose-into-foundation-plus-pilot-plus-follow-ups
chunking strategy, validated by 25 prior successful migrations).

## Acceptance Evidence

- Diff covering the move of `RepoTasksClient` and its 13 supporting
  types from `src/core/server/kota-client.ts` into
  `src/modules/repo-tasks/client.ts`, the new
  `buildRepoTasksDaemonHandler(link)` factory in
  `src/modules/repo-tasks/index.ts`, the deletion of the inline `tasks`
  closure plus 8 helpers and 11 type imports plus
  `REPO_TASK_OPEN_STATES` constant from `daemon-client.ts`, and the
  STUB_OMITTED_NAMESPACES + buildMigratedNamespaceTestStubs entries.
- Line-count snapshots of `src/core/server/kota-client.ts` (before:
  500, after: ~390) and `src/core/server/daemon-client.ts` (before:
  882, after: ~670). Both still over the 300-line guideline; the
  remaining `workflow` migration plus the orthogonal-transport
  decoupling drive them under the limit.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`.kota/runs/<run-id>/transcript.txt`) showing one read (`kota task
  show <id>` or `kota task list`) and one mutation (`kota task move
  <id> <state>` or `kota task capture "<title>"`) producing identical
  output across both transports.
- Test output showing `pnpm typecheck`, `pnpm lint`, and the focused
  `pnpm test --filter daemon-client` plus `pnpm test --filter
  repo-tasks` pass on the changed tree, and the
  `STUB_OMITTED_NAMESPACES` coverage check in `daemon-client.test.ts`
  no longer asserts a core-stub `tasks` closure.
