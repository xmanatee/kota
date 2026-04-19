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
