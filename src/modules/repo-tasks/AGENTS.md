# Repo-Tasks Module

Owns KOTA's task-queue domain: the `data/tasks/` state names, path helpers,
queue snapshot, inbox/state counts, and the `DaemonTaskStatusResponse` shape
served at `/api/tasks`.

- Provides the `kota task` CLI subcommands, HTTP route handlers, queue snapshot
  helpers, and structural validation for `data/tasks/`.
- `repo-tasks-domain.ts` is the source of truth for state constants, path
  helpers, and the queue-snapshot / task-status types. It also owns the
  difference between open/pullable records and dispatchable work
  (`actionableCount`, `promotableBacklogCount`, `dispatchableCount`,
  `hasDispatchableWork`). Other modules must consume those fields rather than
  recalculating actionability from raw state counts, and declare `repo-tasks`
  in their module `dependencies`.
- Every production mutation under `data/tasks/` or `data/inbox/` must use the
  domain write/move operations. Those operations stage the exact changed path
  before returning; staging failure is an operation failure, never a
  best-effort warning. Workflows and routes must not write these files
  directly or maintain a second move/staging implementation.
- The domain mutation boundary owns physical path safety and directory
  creation. It rejects symlinked/non-regular markdown entries and symlinked
  directory components. Isolated helpers enter verified directories and use
  no-follow descriptors plus single-component relative operations, so a raced
  parent replacement cannot redirect a write, move, or removal. Callers must
  not pre-create task or inbox directories before invoking it.
- Task enumeration and reads use that same descriptor-anchored boundary rooted
  at the canonical `data/tasks/` directory. Queue consumers must use the
  verified domain list/read APIs, which reject linked parents and entries and
  return the file snapshot needed to bind a claim; do not discover queue work
  with direct pathname reads.
- Native agent sandboxes may protect Git metadata even when task files are
  writable. An explicit builder runtime owner lets the task mover retain its
  filesystem transition only for a protected-index denial; builder repair then
  retries the repo-tasks domain's claim-scoped staging operation from the host
  before queue validation. Other staging failures still roll back. Do not
  replace that bridge with broad workflow-owned `git add` logic.
- State moves rename and rewrite first, then stage the exact source and
  destination paths together. Keep a real linked-worktree regression around
  repeated moves so a staged deletion plus untracked destination cannot pass
  as a completed transition.
- Cross-cutting runtime replacements opt into the production-adoption gate
  with `production_replacement: true` and a `## Production Replacement Proof`
  section. Its `key: value` fields are `oldBoundary`, `replacementOwner`,
  `liveIngresses`, `restartIngresses`, `observableEffect`,
  `productionEntrypoints`, `productionTests`, `retiredPathCheck`, and
  `evidenceArtifact`; separate list values with ` | `. Entrypoints are non-test
  production source files. The JSON artifact binds every ingress effect and the
  negative retired-path result to exact assertions plus the entrypoints each
  assertion exercises. The domain invokes Vitest directly, reruns every bound
  assertion in isolation, and starts V8 precise coverage only after test-file
  collection so the assertion lifecycle must execute its declared production
  entrypoints. It rejects `done/` when a package script
  bypasses the declared files, an optimistic artifact names an assertion that
  did not pass, or a synthetic assertion never reaches production code. The
  artifact path is the screened, tracked projection under
  `.kota/runs/<run-id>/evidence/artifacts/`, never the ignored
  `.kota/builder-evidence/` source; staging the projection before the task move
  makes the clean-checkout guarantee part of the transition.
- The core daemon no longer proxies task status. `/api/tasks` is computed
  directly from disk in this module.
- Owns the default `RepoTasksProvider` registration. Substring/grep ranking
  against `title + summary + indexable body sections` answers `kota task
  search --keyword`. The `tasks-semantic` module overrides this when an
  embedding provider is configured.
- Exposes a project-scoped task-search resolver for composed seams such as
  recall. The default provider remains the default-project path; non-default
  projects get a store rooted at that project's task queue.
- `kota task search` and `kota task reindex` use the same daemon control
  plane the CLI consumes for `tasks.show`/`tasks.move`. The single seam is
  the bearer-auth `GET /tasks/search` control route; there is intentionally
  no `/api/tasks/search` HTTP mirror — every visual client (macOS
  `DaemonClient.searchTasks`, mobile `searchTasks`, Telegram `/tasks`,
  Slack `/tasks`) calls the same control route or the same in-process
  `RepoTasksClient.search` seam, and the wire envelope is pinned by the
  cross-client conformance fixture (`tasksSearch.{success,
  semanticUnavailable, negative_unknownReason}`).
