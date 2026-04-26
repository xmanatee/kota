---
id: task-add-macos-daemonclientsearchknowledge-with-discrim
title: Add macOS DaemonClient.searchKnowledge with discriminated KnowledgeSearchResponse types and unit tests
status: ready
priority: p2
area: client
summary: Wire the daemon contract layer for the knowledge surface into the macOS menu-bar client: add KnowledgeEntry and the discriminated KnowledgeSearchResponse to Models.swift, add a typed searchKnowledge(query:limit:) method to DaemonClient.swift that targets GET /api/knowledge/search?q=&semantic=true&limit=, and pair the four DaemonClientTests cases (success entries, empty entries, ok:false semantic-unavailable, typed HTTP error) so the view layer in the follow-up subtask can consume a tested seam.
created_at: 2026-04-26T12:54:00.498Z
updated_at: 2026-04-26T12:54:00.498Z
---

## Problem

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has typed
`DaemonClient` methods for `/status`, `/approvals`, `/owner-questions`,
`/tasks`, `/sessions`, `/api/digest`, `/api/attention`, voice, and chat,
but no `searchKnowledge()`. The daemon route `GET /api/knowledge/search`
already returns the discriminated shape
`{ ok: true, entries: KnowledgeEntry[] } | { ok: false, reason: "semantic_unavailable" }`
(`src/modules/knowledge/routes.ts`), and the same body has been wired
through Telegram, the CLI, the web `KnowledgePanel`, and the shared
`renderKnowledgeSearchPlain` helper (`src/modules/knowledge/render.ts`).
Without a typed Swift mirror and `DaemonClient` method for the route, no
view layer in the macOS client can consume the seam without scattering
route strings, JSON decoding, and ad-hoc URL construction across views —
which `clients/macos/AGENTS.md` explicitly forbids.

## Desired Outcome

`DaemonClient.searchKnowledge(query:limit:)` exists and returns the
discriminated `KnowledgeSearchResponse`. `Models.swift` declares the
Swift mirrors. The four `DaemonClientTests` cases prove the seam against
the daemon's exact response contract, including the `ok: false`
semantic-unavailable branch and the typed HTTP error path. The follow-up
view subtask can then consume a tested data layer with no further
contract decisions to make.

## Constraints

- Add `KnowledgeEntry` and `KnowledgeSearchResponse` to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly: `{ ok: true, entries: KnowledgeEntry[] }`
  on success and `{ ok: false, reason: "semantic_unavailable" }` when no
  embedding-backed knowledge provider is configured. Use a discriminated
  Swift representation (e.g. an enum with associated values) — do not
  flatten into a single struct with optional fields, do not invent a
  parallel response type that drifts from the daemon's contract.
- `KnowledgeEntry` carries the same fields the shared knowledge render
  helper consumes (`renderKnowledgeSearchPlain` in
  `src/modules/knowledge/render.ts`): id, type, status, title. Decode
  exactly those fields; do not add or remove fields.
- Add a typed `searchKnowledge(query: String, limit: Int) async throws ->
  KnowledgeSearchResponse` method to
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`. URL-encode the
  query and build the URL via the existing `DaemonConnection` helpers —
  do not concatenate raw strings. Send the bearer token from
  `daemon-control.json` the same way every other `/api/*` method does.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder` and
  `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test target or
  fixture file. Cover exactly four cases:
  1. Successful entries payload (`ok: true`, non-empty entries).
  2. Empty entries payload (`ok: true`, empty entries).
  3. `ok: false` semantic-unavailable payload.
  4. Typed HTTP error path (route returns non-200).

## Done When

- `KnowledgeEntry` and `KnowledgeSearchResponse` exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the discriminated
  `ok: true | false` representation.
- `DaemonClient.searchKnowledge(query:limit:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `KnowledgeSearchResponse`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift` has the
  four cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

Decomposed from
`task-add-macos-menu-bar-knowledgeview-consuming-apiknow`, which timed
out under one builder run while still in the contract-design phase
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp`, ~17 minutes,
streamed-API idle timeout). The original task bundles the daemon
contract layer, the SwiftUI view layer, AppState wiring, MenuBarView
integration, four-branch screenshots, and a docs update — too much for
a single agent run. This subtask owns the contract layer only: typed
mirrors plus the `DaemonClient` method plus its four DaemonClientTests
cases. The follow-up subtask
(`task-add-macos-menu-bar-knowledgeview-consuming-daemonc`) then
consumes the tested seam to ship the view, AppState observables, and
operator screenshots. Keeping the contract in its own task lets the
view subtask focus on UI behavior and operator capture without
re-debating the daemon shape.

## Initiative

Operator-pull parity for the knowledge surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares one
search seam through `GET /api/knowledge/search`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication. This task lands the macOS-side daemon contract layer for
that seam.

## Acceptance Evidence

- Diff covering the new `KnowledgeEntry` and `KnowledgeSearchResponse`
  in `Models.swift`, the new `searchKnowledge(query:limit:)` method on
  `DaemonClient.swift`, and the four new `DaemonClientTests` cases.
- `swift test` output showing all four `searchKnowledge` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
