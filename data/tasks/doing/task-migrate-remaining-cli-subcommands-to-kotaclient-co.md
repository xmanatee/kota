---
id: task-migrate-remaining-cli-subcommands-to-kotaclient-co
title: Migrate remaining CLI subcommands to KotaClient contract
status: doing
priority: p2
area: architecture
summary: Migrate all non-acceptance CLI subcommands across modules to consume ctx.client.<namespace>.<method> instead of direct stores or .kota/ reads; expand the KotaClient contract namespace surface; add per-namespace daemon HTTP routes where needed.
created_at: 2026-04-25T13:17:17.850Z
updated_at: 2026-04-25T15:43:36.000Z
---

## Problem

`task-define-kota-client-contract-and-route-every-cli-su` shipped the
`KotaClient` contract foundation in `src/core/server/`, both implementors
(`DaemonControlClient`, `LocalKotaClient`), the central
`resolveKotaClient` selector, the `ModuleContext.client` surface, the
scoped `src/core/server/AGENTS.md`, and the namespace-registration guard
test. Five acceptance CLI subcommands (`kota workflow list`,
`kota approval list`, `kota secrets list`, `kota task list`,
`kota memory list`) consume only the contract end to end, with both
daemon-up and daemon-down paths verified via captured transcripts under
`.kota/runs/2026-04-25T12-52-28-635Z-builder-tc1aec/`.

The remaining CLI surface — every other subcommand under
`src/modules/*` that today resolves local stores from `ModuleContext`,
imports `getXxxStore()` helpers directly, or reads `.kota/` files
straight from the action handler — has not yet been migrated.

## Desired Outcome

- Every non-bootstrap CLI subcommand resolves its data through
  `ctx.client.<namespace>.<method>()`. The bootstrap exemption stays
  limited to `init`, `registry`, `completion`, and `daemon-ops install`.
- The `KotaClient` contract grows by adding namespaces (knowledge,
  history, agents, skills, harness-parity, owner-questions, webhook,
  approval mutations, secret mutations, eval-harness, guardrails-audit,
  module-manager, web, config, mcp-server, voice, daemon-ops control,
  doctor, repo-tasks mutations, memory mutations, workflow mutations
  and history) — one per declared CLI capability.
- Each namespace has a daemon-side route in the owning module and a
  matching local-side handler registered through
  `ctx.registerLocalClient(<namespace>, ...)`. The namespace is added to
  `KOTA_CLIENT_NAMESPACES` and the registration guard test mapping.
- Direct `.kota/` reads from non-bootstrap CLI code are removed; a
  guard test (extending the existing namespace-registration guard) flags
  new direct reads.

## Constraints

- Do not introduce a second public client surface; everything routes
  through `KotaClient`.
- Output continues to flow through `src/modules/rendering`. CLI
  formatting stays in the action handlers; the contract returns data.
- Existing JSON / pipe-mode behavior for every migrated subcommand is
  preserved.
- Bootstrap subcommands stay the explicit exception, documented in
  their module's local `AGENTS.md` if a new one is added.
- Module-by-module migration is allowed; a single PR-shaped batch per
  cluster of related modules (e.g. all repo-task mutations, all
  approval mutations) is fine. Avoid a single mega-batch that touches
  every module at once — this task is a candidate for further
  decomposition by the decomposer when promoted to ready.

## Done When

- Every non-bootstrap module that contributes CLI subcommands routes
  every read and mutation through `ctx.client.<namespace>.<method>()`
  rather than imported stores or `.kota/` reads.
- `KOTA_CLIENT_NAMESPACES` enumerates every contract namespace.
- The namespace-registration guard test in
  `src/core/server/kota-client-guard.test.ts` covers every namespace
  and is extended (or paired with a sibling guard) to reject new
  direct `.kota/` filesystem reads from non-bootstrap CLI code.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `pnpm kota task list`, `pnpm kota memory list`, `pnpm kota approval list`,
  `pnpm kota secrets list`, and `pnpm kota workflow list` continue to
  produce identical output between daemon-up and daemon-down runs.

## Source / Intent

Foundation work landed in
`task-define-kota-client-contract-and-route-every-cli-su` (see that
task's "Source / Intent" for the original 2026-04-25 owner capture from
`data/inbox/cli-still-feels-poor.md`). The umbrella architectural
intent — a single typed contract every CLI subcommand consumes — is
preserved here for the remaining modules. The audit decomposed the
umbrella into a contract+migration child plus a navigator child; the
contract+migration child shipped the foundation in
`.kota/runs/2026-04-25T12-52-28-635Z-builder-tc1aec/`. This task carries
forward the per-module migration the foundation enables.

## Initiative

Product-grade KOTA clients: a single daemon control contract that the
CLI, native/web/mobile apps, and future operator clients all consume the
same way, with the CLI as the reference interactive client.

## Acceptance Evidence

- Diff covering namespace additions to `kota-client.ts`, daemon-client
  property impls, route additions, and per-module `onLoad`
  `registerLocalClient(...)` calls.
- Updated namespace-registration guard test enumerating every namespace.
- Refreshed daemon-up and daemon-down CLI transcripts demonstrating
  parity for the migrated subcommands beyond the original five.
- Grep evidence in the run directory that no non-bootstrap CLI
  subcommand under `src/modules/*` reads `.kota/` directly.

## Status

Cluster-by-cluster migration is in progress. Each cluster ships in one
builder run; this task remains in `doing/` between runs and is resumed
until `Done When` is fully satisfied.

- Done — `secrets`: `set` / `get` / `remove` now route through
  `ctx.client.secrets.*`. Daemon adds `PUT /api/secrets/{name}`,
  `GET /api/secrets/{name}`, `DELETE /api/secrets/{name}?scope=...`
  under bearer auth; local-side handler covers the same surface
  (run `2026-04-25T13-36-09-141Z-builder-avofqm`).
- Done — `approval` mutations and reads: `approve`, `reject`,
  `approve-all`, `reject-all`, `count`, and `history` now route
  through `ctx.client.approvals.{list,approve,reject}`.
  `ApprovalsClient.list` accepts an optional `{status}` filter
  (`ApprovalStatus | "all"`, default "pending") and the public
  `GET /api/approvals?status=...` plus the daemon-control
  `GET /approvals?status=...` route forwards it through to
  `queue.list(status)` (run
  `2026-04-25T13-56-13-058Z-builder-wcqhyv`).
- Done — `memory` mutations: `add`, `delete`, `search`, and
  `reindex` now route through `ctx.client.memory.{add,delete,search,reindex}`.
  `MemoryClient.search` returns
  `{ ok: true, entries } | { ok: false, reason: "semantic_unavailable" }`
  so the embedding-required-but-absent error stays explicit. Daemon
  adds `GET /api/memory/search?q=...&semantic=...&tag=...&since=...&limit=...`
  and `POST /api/memory/reindex`; existing `POST /api/memory` and
  `DELETE /api/memory/:id` cover add and delete. The CLI no longer
  imports `getMemoryProvider` (run
  `2026-04-25T14-16-07-951Z-builder-3h8o0y`).
- Done — `repo-tasks` mutations: `move`, `gc`, `create`, `capture`, and
  `show` now route through `ctx.client.tasks.{show,move,create,capture,gc}`.
  `RepoTasksClient` grew typed shapes
  (`RepoTaskShowResult`, `RepoTaskMoveResult`,
  `RepoTaskCreateResult`, `RepoTaskCaptureResult`, `RepoTaskGcResult`)
  with explicit `{ ok: true } | { ok: false; reason }` discriminants.
  Daemon adds `GET /api/tasks/{id}`, `PATCH /api/tasks/{id}/move`
  (full state set, distinct from web-UI restricted
  `PATCH /api/tasks/{id}/state`), `POST /api/tasks/normalized`,
  `POST /api/tasks/capture`, and `POST /api/tasks/gc`. The shared
  mutation logic lives in `src/modules/repo-tasks/repo-tasks-operations.ts`
  so the daemon route handlers and the local-client handlers cannot
  diverge. The CLI no longer reads/writes `data/tasks/` or `.kota/`
  directly from any subcommand action (run
  `2026-04-25T14-40-55-087Z-builder-wrugq7`).
- Done — `owner-questions` reads and mutations: `list`, `answer`,
  `dismiss`, `count`, and `history` now route through
  `ctx.client.ownerQuestions.{list,answer,dismiss}`. `OwnerQuestionsClient`
  uses `{ status?: OwnerQuestionStatus | "all" }` (default `"pending"`)
  for `list`, mirroring the approvals namespace; mutations return
  `{ ok: true; question } | { ok: false; reason: "not_found" }`.
  Existing daemon-control routes (`GET /owner-questions`,
  `POST /owner-questions/:id/answer`,
  `POST /owner-questions/:id/dismiss`) and the public
  `GET /api/owner-questions` route gained an optional `?status=` query
  forwarded into the shared `listOwnerQuestionsLocal` helper. The
  `kota owner-question` CLI no longer imports
  `getOwnerQuestionQueue` (run
  `2026-04-25T15-06-46-060Z-builder-ws6oel`).
- Done — `history` reads, mutations, and resume/continue resolvers:
  `kota history list`, `show`, `delete`, `clear`, and `resume` now
  route through `ctx.client.history.{list,show,delete}`, and the
  `kota run --continue` resolver in `src/cli.ts` calls
  `resolveRunContinue(client, opts)` which uses the same contract.
  `HistoryClient.list({ search?, limit?, cwd?, source? })` returns
  `{ conversations: ConversationRecord[] }`; `show(id)` returns
  `{ found: true; data } | { found: false }`; `delete(id)` returns
  `{ ok: true } | { ok: false; reason: "not_found" }`. The existing
  daemon-control `/history` and `/history/:id` routes plus the public
  `/api/history` route gained `?cwd=` and `?source=` filters forwarded
  through `listHistoryLocal` so daemon-up and daemon-down callers see
  identical filtered results. `findByPrefix` and `getMostRecent` are
  derived in CLI from `list` (no second contract method), with
  ambiguous-prefix detection in `resolveConversationId(client, …)`.
  CLI no longer imports `getHistory` from any subcommand action handler
  (run `2026-04-25T15-25-46-109Z-builder-hj89qi`).
- Pending — `workflow` mutations (control, run management, definition
  mutations, trigger/exec); `knowledge`, `agent-ops`, `skill-ops`,
  `harness-parity`, `webhook`, `eval-harness`, `guardrails-audit`,
  `module-manager`, `web`, `config`, `mcp-server`, `voice`,
  `daemon-ops` control, `doctor`.
- Pending — sibling guard test rejecting new direct `.kota/` reads
  from non-bootstrap CLI code.

The decomposer may split this task into per-cluster child tasks at any
time if a single cluster warrants its own queue entry.
