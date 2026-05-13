# Repo-Tasks Module

Owns KOTA's task-queue domain: the `data/tasks/` state names, path helpers,
queue snapshot, inbox/state counts, and the `DaemonTaskStatusResponse` shape
served at `/api/tasks`.

- Provides the `kota task` CLI subcommands, HTTP route handlers, queue snapshot
  helpers, and structural validation for `data/tasks/`.
- `repo-tasks-domain.ts` is the source of truth for state constants, path
  helpers, and the queue-snapshot / task-status types. Other modules import it
  as `#modules/repo-tasks/repo-tasks-domain.js` and declare `repo-tasks` in
  their module `dependencies`.
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
