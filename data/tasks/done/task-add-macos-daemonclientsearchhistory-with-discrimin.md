---
id: task-add-macos-daemonclientsearchhistory-with-discrimin
title: Add macOS DaemonClient.searchHistory with discriminated HistorySearchResponse types and unit tests
status: done
priority: p2
area: client
summary: Wire the daemon contract layer for the conversation-history surface into the macOS menu-bar client: add ConversationRecord and the discriminated HistorySearchResponse to Models.swift, add a typed searchHistory(query:limit:) method to DaemonClient.swift that targets GET /api/history/search?q=&semantic=true&limit=, mirror renderHistorySearchPlain in Swift, and pair the four DaemonClientTests cases (success conversations, empty conversations, ok:false semantic-unavailable, typed HTTP error) so the view layer in the follow-up subtask can consume a tested seam.
created_at: 2026-04-27T03:38:32.926Z
updated_at: 2026-04-27T03:42:34.602Z
---

## Problem

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`, voice,
and chat — but no `searchHistory()`. The daemon route
`GET /api/history/search` already returns the discriminated shape
`{ ok: true, conversations: ConversationRecord[] } | { ok: false, reason: "semantic_unavailable" }`
(`src/modules/history/routes.ts:84-112`), and the same body has been
wired through Telegram (just-shipped `/history` command, commit
`8fe35c69`), the CLI (`kota history search`, commit `2967c907`), the
daemon HTTP route (`72cf00c3`), and the shared
`renderHistorySearchPlain` helper (`src/modules/history/render.ts`).
Without a typed Swift mirror and `DaemonClient` method for the route,
no view layer in the macOS client can consume the seam without
scattering route strings, JSON decoding, and ad-hoc URL construction
across views — which `clients/macos/AGENTS.md` explicitly forbids and
which the `searchKnowledge` and `searchMemory` predecessors deliberately
avoided.

## Desired Outcome

`DaemonClient.searchHistory(query:limit:)` exists and returns the
discriminated `HistorySearchResponse`. `Models.swift` declares the Swift
mirrors. The four `DaemonClientTests` cases prove the seam against the
daemon's exact response contract, including the `ok: false`
semantic-unavailable branch and the typed HTTP error path. The
follow-up view subtask can then consume a tested data layer with no
further contract decisions to make.

## Constraints

- Add `ConversationRecord` and `HistorySearchResponse` to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly: `{ ok: true, conversations: ConversationRecord[] }`
  on success and `{ ok: false, reason: "semantic_unavailable" }` when
  the configured history provider does not support semantic search.
  Use a discriminated Swift representation (e.g. an enum with
  associated values, exactly like `KnowledgeSearchResponse` and
  `MemorySearchResponse` in the same file) — do not flatten into a
  single struct with optional fields, do not invent a parallel response
  type that drifts from the daemon's contract.
- `ConversationRecord` carries the same fields the shared history
  render helper consumes (`renderHistorySearchPlain` in
  `src/modules/history/render.ts` and the `ConversationRecord` shape in
  `src/core/modules/provider-types.ts:9-19`): `id`, `title`,
  `createdAt` (ISO-8601 string), `updatedAt` (ISO-8601 string), `model`,
  `messageCount`, `cwd`, and optional `source: "user" | "action"`.
  Decode exactly those fields; do not add or remove fields. The
  optional `source` is the only nullable shape, matching the upstream
  type — do not promote it to a non-optional default.
- Mirror `renderHistorySearchPlain` as a Swift helper alongside
  `renderKnowledgeSearchPlain` and `renderMemorySearchPlain` so the
  macOS surface emits the same id / updated-date / message-count /
  title line shape as Telegram, the CLI, and any other surface that
  consumes the helper. The id column pads to the widest id in the
  result (minimum width 2), the updated-date column slices the first
  16 chars of `updatedAt` and replaces `T` with a space, and the
  message-count column pads `${messageCount}` to width 4 followed by
  ` msgs`, matching `src/modules/history/render.ts:16-24` exactly.
- Add a typed `searchHistory(query: String, limit: Int) async throws -> HistorySearchResponse`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  URL-encode the query and build the URL via `URLComponents` — do not
  concatenate raw strings. Send the bearer token from
  `daemon-control.json` the same way every other `/api/*` method does.
  Pattern after the existing `searchKnowledge(query:limit:)` and
  `searchMemory(query:limit:)` methods one-to-one. Pass `semantic=true`
  as a query param so the route follows the same code path Telegram and
  the CLI exercise; do not add a non-semantic fallback.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder` and
  `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test target
  or fixture file. Cover exactly four cases:
  1. Successful conversations payload (`ok: true`, non-empty
     conversations).
  2. Empty conversations payload (`ok: true`, empty conversations).
  3. `ok: false` semantic-unavailable payload.
  4. Typed HTTP error path (route returns non-200).

## Done When

- `ConversationRecord` and `HistorySearchResponse` exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the
  discriminated `ok: true | false` representation, plus a
  `renderHistorySearchPlain` Swift helper that mirrors
  `src/modules/history/render.ts`.
- `DaemonClient.searchHistory(query:limit:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `HistorySearchResponse`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift` has
  the four cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger) follows the
just-shipped Telegram `/history` command (commit `8fe35c69`), which
landed alongside the daemon `GET /api/history/search` route (`72cf00c3`)
and the `kota history search` CLI subcommand (`2967c907`). The seed
commit `3bbd1cb3` ("Seed conversation/recall fan-out from empty queue")
opened the conversation-history surface fan-out at the same starting
surfaces used by digest, attention, knowledge, and memory: daemon
route + CLI + Telegram first, then the macOS+mobile seam. The next
step in the cadence established by the just-finished memory fan-out is
the macOS DaemonClient contract task — `task-add-macos-daemonclientsearchmemory-with-discrimina`
(commit `f915cbd7`) was the direct predecessor before the macOS view
and mobile screen subtasks. This task mirrors that template one-to-one
for the conversation-history surface. Decomposing the macOS-side
contract from the view follows the same lesson the knowledge cluster
encoded (`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp` timed out
at ~17 minutes when the contract layer plus SwiftUI view plus AppState
wiring plus operator capture were bundled into one builder run): keep
the typed contract task scoped to `Models.swift` + `DaemonClient.swift`
+ `DaemonClientTests.swift` so the follow-up view subtask can focus on
UI behavior and operator capture without re-debating the daemon shape.

## Initiative

Operator-pull parity for the conversation-history surface: every
primary operator client (Telegram, terminal, daemon HTTP, web, macOS,
mobile) shares one semantic-search seam through
`GET /api/history/search`, with surface-specific delivery wired through
standard module patterns rather than per-surface duplication. This
task lands the macOS-side daemon contract layer for that seam.

## Acceptance Evidence

- Diff covering the new `ConversationRecord`, `HistorySearchResponse`,
  and `renderHistorySearchPlain` in `Models.swift`, the new
  `searchHistory(query:limit:)` method on `DaemonClient.swift`, and
  the four new `DaemonClientTests` cases.
- `swift test` output showing all four `searchHistory` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
