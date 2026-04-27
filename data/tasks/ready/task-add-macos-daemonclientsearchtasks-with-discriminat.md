---
id: task-add-macos-daemonclientsearchtasks-with-discriminat
title: Add macOS DaemonClient.searchTasks with discriminated TasksSearchResponse types and unit tests
status: ready
priority: p2
area: client
summary: Wire the daemon contract layer for the repo-task-queue semantic-search seam into the macOS menu-bar client: add RepoTaskSearchHit and the discriminated TasksSearchResponse to Models.swift, add a typed searchTasks(query:limit:states:) method to DaemonClient.swift that targets GET /tasks/search?q=&semantic=true&limit=, mirror renderRepoTaskSearchPlain in Swift, and pair the four DaemonClientTests cases (success tasks, empty tasks, ok:false semantic-unavailable, typed HTTP error) so the follow-up TaskSearchView subtask consumes a tested seam.
created_at: 2026-04-27T06:30:43.682Z
updated_at: 2026-04-27T06:30:43.682Z
---

## Problem

The `tasks-semantic` seam is now exposed on three operator surfaces:

- `kota task search` CLI (`src/modules/repo-tasks/cli.ts:277`).
- Daemon control route `GET /tasks/search`
  (`src/modules/repo-tasks/routes.ts:531-592`); the route returns
  `{ ok: true, tasks: RepoTaskSearchHit[] } | { ok: false, reason: "semantic_unavailable" }`
  so callers do not silently degrade to keyword search behind the
  operator's back.
- Telegram `/tasks <query>` command, rendered via the shared
  `renderRepoTaskSearchPlain` helper (`src/modules/repo-tasks/render.ts`)
  through `ctx.client.tasks.search` (`src/modules/telegram/status-poll.ts:226`).

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`, voice, and chat — but no `searchTasks()`. The
existing `tasks()` method returns the state-grouped task counts from
`/tasks` (the queue status surface), not the semantic-search seam.

Without a typed Swift mirror and `DaemonClient` method for the
`/tasks/search` route, no view layer in the macOS client can consume
the seam without scattering route strings, JSON decoding, and ad-hoc
URL construction across views — which `clients/macos/AGENTS.md`
explicitly forbids and which the `searchKnowledge`, `searchMemory`,
and `searchHistory` predecessors deliberately avoided.

## Desired Outcome

`DaemonClient.searchTasks(query:limit:states:)` exists and returns the
discriminated `TasksSearchResponse`. `Models.swift` declares the Swift
mirrors. The four `DaemonClientTests` cases prove the seam against the
daemon's exact response contract, including the `ok: false`
semantic-unavailable branch and the typed HTTP error path. The
follow-up `TaskSearchView` subtask can then consume a tested data
layer with no further contract decisions to make.

## Constraints

- Add `RepoTaskSearchHit` and `TasksSearchResponse` to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly: `{ ok: true, tasks: RepoTaskSearchHit[] }`
  on success and `{ ok: false, reason: "semantic_unavailable" }` when
  the configured `repo-tasks` provider does not support semantic
  search. Use a discriminated Swift representation (e.g. an enum with
  associated values, exactly like `KnowledgeSearchResponse`,
  `MemorySearchResponse`, and `HistorySearchResponse` in the same
  file) — do not flatten into a single struct with optional fields,
  do not invent a parallel response type that drifts from the
  daemon's contract.
- `RepoTaskSearchHit` carries the same fields the shared render helper
  consumes (`renderRepoTaskSearchPlain` in
  `src/modules/repo-tasks/render.ts` and the `RepoTaskSearchHit`
  shape in `src/core/modules/provider-types.ts:258-267`): `id`,
  `title`, `state` (one of `backlog | ready | doing | blocked | done
  | dropped`), `priority`, `area`, `summary`, `updatedAt` (ISO-8601
  string), and `score` (Double). Decode exactly those fields; do not
  add or remove fields. No nullable shape — every field is required
  on the daemon side.
- Mirror `renderRepoTaskSearchPlain` as a Swift helper alongside
  `renderKnowledgeSearchPlain`, `renderMemorySearchPlain`, and
  `renderHistorySearchPlain` so the macOS surface emits the same
  id / state / priority / title line shape as Telegram, the CLI,
  and any other surface that consumes the helper. The id column
  pads to the widest id in the result (minimum width 2), the state
  column pads to the widest state (minimum width 5), the priority
  column pads to the widest priority (minimum width 4), and columns
  are joined by two spaces — matching `src/modules/repo-tasks/render.ts:11-24`
  exactly.
- Add a typed
  `searchTasks(query: String, limit: Int, states: [String]?) async throws -> TasksSearchResponse`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  URL-encode the query and build the URL via `URLComponents` — do
  not concatenate raw strings. The route is `/tasks/search` (a
  daemon control route, not under `/api/`), unlike the
  `searchKnowledge`/`searchMemory`/`searchHistory` predecessors that
  hit `/api/...`. Send the bearer token from `daemon-control.json`
  the same way every other `DaemonClient` method does. Pattern the
  call after the existing `searchHistory(query:limit:)` method
  one-to-one but with the route adjusted. Pass `semantic=true` as a
  query param so the route follows the same code path Telegram and
  the CLI exercise; do not add a non-semantic fallback.
- `states` (when provided) is appended as repeated `state=<value>`
  query parameters, matching the route handler's
  `url.searchParams.getAll("state")` behavior in
  `src/modules/repo-tasks/routes.ts:542-545`.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder` and
  `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test target
  or fixture file. Cover exactly four cases:
  1. Successful tasks payload (`ok: true`, non-empty tasks).
  2. Empty tasks payload (`ok: true`, empty tasks).
  3. `ok: false` semantic-unavailable payload.
  4. Typed HTTP error path (route returns non-200).

## Done When

- `RepoTaskSearchHit` and `TasksSearchResponse` exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the
  discriminated `ok: true | false` representation, plus a
  `renderRepoTaskSearchPlain` Swift helper that mirrors
  `src/modules/repo-tasks/render.ts`.
- `DaemonClient.searchTasks(query:limit:states:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `TasksSearchResponse`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift` has
  the four cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped Telegram `/tasks`
command (commit `fc471f0b`), which landed alongside the
`tasks-semantic` provider, the `/tasks/search` daemon route, the
`ctx.client.tasks.search` namespace, and the `kota task search` CLI
subcommand (`7bd41ed7`). The seed commit `fa0ee92e` opened the
repo-task-queue semantic-search fan-out and wrote the cadence
contract one-to-one with the prior knowledge / memory / history
fan-outs: daemon route + CLI + Telegram first, then the macOS
DaemonClient + macOS view + mobile screen. The macOS DaemonClient
contract task is the next step; decomposing it from the view follows
the lesson the knowledge cluster encoded
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp` timed out at
~17 minutes when the contract layer plus SwiftUI view plus AppState
wiring plus operator capture were bundled into one builder run).
This task mirrors the
`task-add-macos-daemonclientsearchhistory-with-discrimin` template
one-to-one for the repo-task-queue surface, with the route adjusted
from `/api/history/search` to `/tasks/search` (daemon control route).

## Initiative

Operator-pull parity for the repo-task-queue surface: every primary
operator client (Telegram, terminal, daemon, macOS, mobile) shares
one semantic-search seam through `GET /tasks/search`, with
surface-specific delivery wired through standard module patterns
rather than per-surface duplication. This task lands the macOS-side
daemon contract layer for that seam.

## Acceptance Evidence

- Diff covering the new `RepoTaskSearchHit`, `TasksSearchResponse`,
  and `renderRepoTaskSearchPlain` in `Models.swift`, the new
  `searchTasks(query:limit:states:)` method on `DaemonClient.swift`,
  and the four new `DaemonClientTests` cases.
- `swift test` output showing all four `searchTasks` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
