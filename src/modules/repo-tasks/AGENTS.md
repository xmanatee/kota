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
- `kota task search` and `kota task reindex` use the same control plane the
  CLI consumes for `tasks.show`/`tasks.move`. There is no public
  `/api/tasks/search` route — fan-out to Telegram/macOS/mobile is left to
  follow-up tasks in the established cadence.
