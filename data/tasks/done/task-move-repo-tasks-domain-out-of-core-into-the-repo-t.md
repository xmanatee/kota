---
id: task-move-repo-tasks-domain-out-of-core-into-the-repo-t
title: Move repo-tasks domain out of core into the repo-tasks module
status: done
priority: p2
area: architecture
summary: Relocate src/core/data/repo-tasks.ts and the daemon-side readTaskStatus/DaemonTaskStatusResponse surface into the repo-tasks module so KOTA's task-queue domain lives with its owning module, removing a core-leak of state-names and inbox knowledge and extending the sqlite-memory / mcp-server / semantic-index extraction pattern
created_at: 2026-04-19T17:37:20.188Z
updated_at: 2026-04-19T18:45:52.096Z
---

## Problem

`src/core/data/repo-tasks.ts` defines `REPO_TASKS_DIR`,
`REPO_INBOX_DIR`, `REPO_TASK_STATES`, `RepoTaskQueueSnapshot`,
`getRepoTaskQueueSnapshot`, `isThinPullQueue`, `countRepoTaskState`
and related path/state helpers. That is the canonical model of
KOTA's task queue — an explicitly project-data concept — yet it
lives in `src/core/`. Almost every consumer is either the
`repo-tasks` module itself (cli, routes, validation) or an
`autonomy` workflow that already declares `repo-tasks` as a
dependency. The `repo-tasks` module even carries a doc comment
that claims "The underlying RepoTask types and state constants
live in `repo-tasks.ts`, co-located in this module" — the comment
is aspirational; the file is still in core.

The same leak shows up in `src/core/daemon/daemon-handle.ts`:
`readTaskStatus` (line 402) reads `data/tasks/<state>` and
`data/inbox` directly, hard-codes the states
`"inbox" | "ready" | "backlog" | "doing" | "blocked"`, parses task
frontmatter, and is wired onto the `DaemonControl` contract via
`getTaskStatus`. `DaemonTaskStatusResponse` is defined in
`src/core/daemon/daemon-control-types.ts` and flows out through
the control API at `GET /tasks`. The only non-test consumer of
`getTaskStatus` is the `repo-tasks` module's own route handler
(`src/modules/repo-tasks/routes.ts`), which turns around and
re-serves the value at `/api/tasks`. That means the core daemon
is acting as a pass-through for a module's own data domain.

Recent extractions (`sqlite-memory`, `mcp-server`,
`semantic-index`) established the pattern: when an implementation
has one owning module, the file moves into the module and core
stops shipping it. `repo-tasks` is the next obvious candidate, and
unlike those moves it also lets the daemon stop pretending to know
what KOTA's task directory layout is.

## Desired Outcome

- The repo-tasks domain model — path constants, the state tuple,
  `RepoTaskQueueSnapshot`, `getRepoTaskQueueSnapshot`,
  `isThinPullQueue`, `countRepoTaskState`, and the path helpers
  currently in `src/core/data/repo-tasks.ts` — lives under
  `src/modules/repo-tasks/` and is imported as
  `#modules/repo-tasks/...`.
- `src/core/data/repo-tasks.ts` is deleted. There is no compat
  re-export from `#core/data/repo-tasks.js`.
- `DaemonTaskStatusResponse`, the `readTaskStatus` implementation,
  and the `getTaskStatus` entry on `DaemonControl` are removed
  from core. The `GET /tasks` control-API endpoint goes away with
  them. `HandlerRegistry`, `daemon-control-types`, and
  `daemon-client.ts` no longer carry a task-status method.
- The `/api/tasks` HTTP route (served by the repo-tasks module)
  computes its response directly from disk in the module, not by
  calling back into the daemon control API.
- Autonomy workflows and any other module consumer import
  repo-tasks types and helpers from the module, not from core.
  Modules that gain a new runtime import add `repo-tasks` to their
  `dependencies` array so `src/module-deps.test.ts` stays green.
- `src/core/data/AGENTS.md` is updated (or the directory removed
  if `repo-tasks.ts` was its main content) so the guidance no
  longer lists the task queue as a core-owned concept. The
  `src/modules/repo-tasks/AGENTS.md` comment that claims the
  helpers are co-located becomes true.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` all pass. The
  existing repo-tasks route tests continue to cover the `/api/tasks`
  response shape and the web client (`clients/web`) consuming
  `DaemonTaskStatusResponse` keeps working — the type moves to the
  module's public surface and the client imports the new path.

## Constraints

- This is a layering move plus minimal plumbing, not a rewrite.
  `RepoTaskQueueSnapshot`, the five state names, inbox semantics,
  `isThinPullQueue` thresholds, and task-status response shape must
  stay byte-for-byte equivalent. No new fields, no renames.
- Do not leave a `#core/data/repo-tasks.js` shim, a
  `@deprecated` pointer, or a dual-path export. Delete the core
  file in the same change that lands the module version.
- Do not leave `getTaskStatus` on `DaemonControl` as a now-unused
  method. Remove it fully, including the control-API route and the
  client method in `src/core/server/daemon-client.ts`.
- Do not widen the `repo-tasks` module surface beyond what is
  required to relocate these concepts. Resist the urge to also
  move unrelated helpers, introduce a new validation surface, or
  re-shape the CLI.
- Respect import direction: after the move, `src/core/` must not
  import from `#modules/repo-tasks/*`. Core code that previously
  used `getRepoTasksDir` / `getRepoInboxDir` either stops needing
  them (because the behavior moved into the module) or uses an
  inline `join(projectDir, "data", ...)` at the narrow point where
  it is required. Do not smuggle the constants back into core under
  a different name.
- Respect the module-dependency declaration rule
  (`src/module-deps.test.ts`). Any module that gains a runtime
  import of `#modules/repo-tasks/*` must list `repo-tasks` in its
  `dependencies` array.
- Do not change the watchlist, explorer, or multi-project daemon
  work in the same change. Those are separate concerns with their
  own open tasks.
- Do not change on-disk data layout, task frontmatter schema, or
  validation rules. This task does not touch `data/tasks/` content
  or the task-queue validation contract.

## Done When

- `src/core/data/repo-tasks.ts` no longer exists, and
  `src/core/data/` contains only format utilities (or is retired
  if nothing else lives there).
- The equivalent exports live under `src/modules/repo-tasks/`
  and every consumer in `src/` and `clients/` imports them from
  the module path.
- `readTaskStatus`, `DaemonTaskStatusResponse`, and
  `DaemonControl.getTaskStatus` no longer exist in `src/core/`.
  The `GET /tasks` control-API endpoint and
  `DaemonClient.getTaskStatus` are removed.
- `/api/tasks` still returns the same JSON shape to the web
  client, served entirely from the repo-tasks module.
- The autonomy module and any other runtime consumer declares
  `repo-tasks` in its `dependencies` where the move introduces a
  new import edge.
- `src/modules/repo-tasks/AGENTS.md` describes the module as the
  owner of KOTA's task-queue domain; `src/core/data/AGENTS.md`
  and any core-level doc no longer claims otherwise.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and
  `src/module-deps.test.ts` all pass.
