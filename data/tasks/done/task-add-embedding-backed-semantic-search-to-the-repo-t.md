---
id: task-add-embedding-backed-semantic-search-to-the-repo-t
title: Add embedding-backed semantic search to the repo task queue
status: done
priority: p2
area: modules
summary: Add a tasks-semantic module that wraps the repo task queue with embedding-backed search, mirroring memory-semantic, knowledge-semantic, and history-semantic, so autonomy workflows and operators can find similar past or open tasks by intent rather than substring/grep.
created_at: 2026-04-27T05:22:49.160Z
updated_at: 2026-04-27T05:43:11.139Z
---

## Problem

The repo task queue under `data/tasks/{backlog,ready,doing,blocked,done,
dropped}/` is now 765 tasks (737 done + 20 dropped + 8 blocked + the open
tail). The `repo-tasks` module exposes `list`, `show`, `move`, `create`,
`capture`, and `gc` — but no search. Every autonomy workflow whose own
prompt asks it to "scan open tasks and related inbox items for overlap"
(explorer, decomposer, inbox-sorter) is forced to fall back to filename
globs, prefix matching on slugs, or full-file grep. That degrades
silently as the queue grows: explorer's recent runs have repeatedly
created near-duplicate fan-out tasks that a semantic match against
recent done work would have surfaced. Operators hit the same wall on
the CLI side — `pnpm kota task list` enumerates by state but cannot
answer "what did we already do about X" without `git log -S` or shelling
out to `rg`.

The repo already has the right seam for this. `memory-semantic`,
`knowledge-semantic`, and `history-semantic` each wrap their respective
default store with a `SemanticStore` that uses the shared
`semantic-index` module's embedding provider, cosine similarity, sidecar
embeddings file, and lazy-fill behavior, and register themselves as the
provider via `ctx.registerProvider(...)` when configured. The repo task
queue is the only major operator-and-autonomy-relevant store still
without this seam.

## Desired Outcome

A new `tasks-semantic` module wraps the repo task queue with
embedding-backed search. When the operator configures the embedding
provider, callers can rank tasks across all states by semantic
relevance against `title + summary + body`. Without that config, the
module is inactive — the existing `repo-tasks` provider still answers
keyword/substring search and there is no behavioral change.

The new search seam is reachable from one place — the existing `tasks`
KotaClient namespace — through a typed `search(query, options)` method
that returns a discriminated `{ ok: true, tasks: RepoTaskSearchHit[] }
| { ok: false, reason: "semantic_unavailable" }` envelope. A
`kota task search <query>` CLI subcommand consumes the namespace and
renders ranked hits through the rendering module, alongside a
`kota task reindex` subcommand that mirrors `kota memory reindex`,
`kota knowledge reindex`, and `kota history reindex`. Fan-out to other
clients (Telegram, daemon HTTP route, macOS, mobile) is explicitly
left to follow-up tasks in the established cadence — this task lands
the foundation seam.

## Constraints

- Reuse the `semantic-index` module's embedding provider, cosine
  similarity, lazy-fill behavior, and `SemanticIndexManager`. Do not
  introduce a second embedding stack or a parallel cache file format.
- The sidecar embeddings file lives under the project's runtime state
  (`<projectDir>/.kota/`), not next to the git-tracked task files in
  `data/tasks/`. The sidecar is a runtime cache, not source state.
- Introduce a `RepoTasksProvider` seam in `core/modules/provider-types.ts`
  exposing at minimum `searchTasks(query, opts)`, `reindex()`, and
  `supportsSemanticSearch()`. The default implementation lives in the
  `repo-tasks` module and answers substring/grep ranking against the
  same `title + summary + body` text without embeddings, returning
  `supportsSemanticSearch() === false`. The `tasks-semantic` module
  registers an overriding provider that does embedding-backed ranking
  and returns `supportsSemanticSearch() === true`. Same shape as the
  history/memory/knowledge provider seams; no parallel pattern.
- Indexable text per task = `title` + `summary` + the
  `## Problem`, `## Desired Outcome`, `## Constraints`, `## Source /
  Intent`, and `## Initiative` body sections. Do not index `## Plan` or
  `## Acceptance Evidence` — those churn faster than the task's intent
  and would spike re-embed traffic without improving recall.
- Fingerprint per task = the frontmatter `updated_at` ISO string the
  CLI already maintains via `pnpm kota task move|create`. The semantic
  store re-embeds an entry only when its fingerprint changes; a task
  state transition that bumps `updated_at` triggers a re-embed.
- Embedding writes happen on the shared background queue, never inline
  with a task mutation. A semantic write that fails must not corrupt
  or block the underlying file write.
- Query-time embedding errors surface to the caller as
  `{ ok: false, reason: "semantic_unavailable" }`. Do not silently
  degrade to keyword search at query time — the `tasks` namespace
  caller must be able to distinguish "nothing matched" from "embedding
  provider unreachable", same shape the history seam already exposes.
- Search defaults to all states (`backlog`, `ready`, `doing`, `blocked`,
  `done`, `dropped`). The `search(query, options)` method accepts a
  `states?: RepoTaskState[]` filter so callers can scope to open
  states only when that's the right query (e.g. autonomy
  overlap-checks).
- The `RepoTaskSearchHit` shape carries the task `id`, `title`,
  `state`, `priority`, `area`, `summary`, `updated_at`, and the
  cosine similarity `score` so downstream renderers can show
  ranked hits without re-reading every file. Do not return the full
  body — callers that want detail call `tasks.show(id)`.
- `kota task search <query>` defaults to semantic ranking; on
  `semantic_unavailable` it prints a clear single-line operator
  message and exits non-zero (no silent keyword fallback). A
  `--keyword` flag forces the substring/grep path through the default
  `repo-tasks` provider for parity with prior behavior.
- `kota task reindex` mirrors `kota memory reindex` / `kota knowledge
  reindex` / `kota history reindex` — same flags, same output shape,
  same exit-code conventions. No new CLI shape.
- Core must not import from `#modules/tasks-semantic/*`. Honor the
  repo-wide `no-module-imports-in-core` guard.
- The existing `repo-tasks` and `tasks-semantic` modules each declare
  their dependencies correctly (`tasks-semantic` declares
  `["repo-tasks", "semantic-index"]`).
- No fan-out in this task. Do not add Telegram/macOS/mobile/web
  consumers, do not add a daemon HTTP `GET /api/tasks/search` route,
  do not touch `clients/`. Those are explicit follow-up tasks in the
  same cadence the digest, attention, knowledge, memory, and history
  seams used.

## Done When

- `src/modules/tasks-semantic/` exists with `index.ts`, a
  `SemanticTasksStore` wrapping the default `RepoTasksProvider`,
  focused unit tests, and a local `AGENTS.md` describing the seam
  (same shape as `history-semantic/AGENTS.md`).
- `core/modules/provider-types.ts` declares `RepoTasksProvider` with
  `searchTasks(query, opts) -> RepoTaskSearchHit[]`, `reindex() ->
  ReindexResult`, and `supportsSemanticSearch()`. The default
  implementation under `src/modules/repo-tasks/` satisfies the seam
  with substring/grep ranking and returns
  `supportsSemanticSearch() === false`.
- The `tasks-semantic` module registers itself as the `repo-tasks`
  provider during `onLoad` when configured; otherwise it is inactive
  and the default keyword behavior is identical to today.
- `RepoTasksClient` gains a `search(query, opts)` method returning
  `{ ok: true, tasks: RepoTaskSearchHit[] } | { ok: false, reason:
  "semantic_unavailable" }`. The local handler delegates to the
  registered provider.
- `kota task search <query>` and `kota task reindex` ship as
  subcommands of the existing `kota task` group, registered through
  the `repo-tasks` module's `commands` contribution. Output flows
  through the rendering module; `--json` / bare-id paths follow the
  module-rendering contract.
- A focused fixture-driven test exercises a query whose intent matches
  a past task under different wording: substring search misses,
  semantic search returns the relevant task at rank 1.
- Semantic-unavailable branch is covered: when the embedding provider
  raises at query time, the namespace returns the `{ ok: false,
  reason: "semantic_unavailable" }` envelope and the CLI prints a
  single-line operator message and exits non-zero.
- `kota task reindex` populates the sidecar; the first semantic query
  lazily fills entries the sidecar is missing.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Source / Intent

Identified by explorer in run
`.kota/runs/2026-04-27T05-18-12-563Z-explorer-ywrg7r/` after the
history-seam fan-out completed (`task-add-mobile-historyscreen-
consuming-searchhistory`, commit `6fe77680` 2026-04-27). The history
fan-out was the last cadence step closing the
`Telegram → CLI → daemon HTTP → macOS → mobile` loop on the conversation
seam, after digest, attention, knowledge, and memory. Tasks are the
only major operator-and-autonomy-relevant store still without an
embedding-backed search seam, despite being the store autonomy
workflows are explicitly told to scan for overlap (`data/tasks/
AGENTS.md`: "Before creating a task, scan open tasks and related inbox
items for overlap"). With 737+ done tasks already on disk, that scan
silently degrades unless the seam exists.

## Initiative

Cross-store semantic search uniformity: every operator-and-autonomy-
relevant store (memory, knowledge, history, tasks) gets the same
on-demand semantic search seam through the same `*-semantic` module
pattern, eliminating the asymmetry where the task queue is the only
major store still searched only by state filters and substring/grep.

## Acceptance Evidence

- Diff covering the new `src/modules/tasks-semantic/` module, the
  `RepoTasksProvider` provider seam in `core/modules/provider-types.ts`,
  the default `repo-tasks` keyword implementation, the new `search`
  method on `RepoTasksClient`, and the new `kota task search` /
  `kota task reindex` CLI subcommands, in one cohesive change.
- A test transcript showing the cross-wording fixture: a query whose
  intent matches a past task under different wording is missed by
  substring search and returned at rank 1 by semantic search.
- A test transcript showing the `semantic_unavailable` branch when the
  embedding provider raises at query time, exercised through the CLI
  exit code and through the namespace return shape.
- Sidecar embeddings file appears under `<projectDir>/.kota/` after
  `kota task reindex`; a follow-up `kota task search` query consumes
  it and a freshly-created task is lazily indexed on next query.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` output captured under the run
  directory showing all green.
