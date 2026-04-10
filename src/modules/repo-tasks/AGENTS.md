# Repo-Tasks Module

Owns the `kota task` CLI surface for managing the repo task queue.

- `cli.ts` — operator CLI subcommands for listing, inspecting, and managing tasks.
- `routes.ts` — HTTP route handlers for `/api/tasks` and task state/body mutations; contributed via `KotaModule.routes` (proxy-capable via `DaemonControlClient`).
- `routes.test.ts` — unit tests for the HTTP route handlers (covers both daemon-proxy and standalone paths).
- Task types and state constants live in `src/repo-tasks.ts` (shared with workflow code).
