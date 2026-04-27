---
id: task-add-macos-daemonclientsearchmemory-with-discrimina
title: Add macOS DaemonClient.searchMemory with discriminated MemorySearchResponse types and unit tests
status: done
priority: p2
area: client
summary: Wire the daemon contract layer for the memory surface into the macOS menu-bar client: add MemoryEntry and the discriminated MemorySearchResponse to Models.swift, add a typed searchMemory(query:limit:) method to DaemonClient.swift that targets GET /api/memory/search?q=&semantic=true&limit=, and pair the four DaemonClientTests cases (success entries, empty entries, ok:false semantic-unavailable, typed HTTP error) so the view layer in the follow-up subtask can consume a tested seam.
created_at: 2026-04-27T01:18:16.243Z
updated_at: 2026-04-27T01:22:23.567Z
---

## Problem

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has typed
`DaemonClient` methods for `/status`, `/approvals`, `/owner-questions`,
`/tasks`, `/sessions`, `/api/digest`, `/api/attention`,
`/api/knowledge/search`, voice, and chat, but no `searchMemory()`. The
daemon route `GET /api/memory/search` already returns the discriminated
shape
`{ ok: true, entries: MemoryListEntry[] } | { ok: false, reason: "semantic_unavailable" }`
(`src/modules/memory/routes.ts:116-143`), and the same body has been wired
through Telegram (just-shipped `/memory` command), the CLI
(`kota memory search`), the daemon HTTP route, and the shared
`renderMemorySearchPlain` helper (`src/modules/memory/render.ts`). Without
a typed Swift mirror and `DaemonClient` method for the route, no view
layer in the macOS client can consume the seam without scattering route
strings, JSON decoding, and ad-hoc URL construction across views — which
`clients/macos/AGENTS.md` explicitly forbids.

## Desired Outcome

`DaemonClient.searchMemory(query:limit:)` exists and returns the
discriminated `MemorySearchResponse`. `Models.swift` declares the Swift
mirrors. The four `DaemonClientTests` cases prove the seam against the
daemon's exact response contract, including the `ok: false`
semantic-unavailable branch and the typed HTTP error path. The follow-up
view subtask can then consume a tested data layer with no further
contract decisions to make.

## Constraints

- Add `MemoryEntry` and `MemorySearchResponse` to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly: `{ ok: true, entries: MemoryEntry[] }` on
  success and `{ ok: false, reason: "semantic_unavailable" }` when no
  embedding-backed memory provider is configured. Use a discriminated
  Swift representation (e.g. an enum with associated values, exactly
  like `KnowledgeSearchResponse` in the same file) — do not flatten into
  a single struct with optional fields, do not invent a parallel
  response type that drifts from the daemon's contract.
- `MemoryEntry` carries the same fields the shared memory render helper
  consumes (`renderMemorySearchPlain` in `src/modules/memory/render.ts`
  and the `MemoryListEntry` shape in
  `src/core/server/kota-client.ts`): `id`, `created` (ISO-8601 string),
  `content`. Decode exactly those fields; do not add or remove fields
  (in particular, do not pull in `tags`, `embedding`, or any other
  internal memory fields that are intentionally not on the search wire
  shape).
- Mirror `renderMemorySearchPlain` as a Swift helper alongside
  `renderKnowledgeSearchPlain` so the macOS surface emits the same id /
  date / content snippet line shape as Telegram, the CLI, and any other
  surface that consumes the helper. Snippet width (60 chars) and date
  width (16 chars, the ISO-8601 `YYYY-MM-DD HH:MM` slice) match
  `src/modules/memory/render.ts:14-22` exactly. Newlines inside content
  collapse to a single space before truncation, matching the helper.
- Add a typed `searchMemory(query: String, limit: Int) async throws ->
  MemorySearchResponse` method to
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`. URL-encode the
  query and build the URL via `URLComponents` — do not concatenate raw
  strings. Send the bearer token from `daemon-control.json` the same way
  every other `/api/*` method does. Pattern after the existing
  `searchKnowledge(query:limit:)` method one-to-one.
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

- `MemoryEntry` and `MemorySearchResponse` exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the discriminated
  `ok: true | false` representation, plus a `renderMemorySearchPlain`
  Swift helper that mirrors `src/modules/memory/render.ts`.
- `DaemonClient.searchMemory(query:limit:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `MemorySearchResponse`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift` has the
  four cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the just-shipped
Telegram `/memory` command (commit `190770b3`), which opened the memory
surface fan-out at the same starting surface used by the digest,
attention, and knowledge fan-outs. The next step in the cadence
established by the just-finished knowledge fan-out is the macOS
DaemonClient contract task — `task-add-macos-daemonclientsearchknowledge-with-discrim`
(commit `b363a54a`) was the direct predecessor before the macOS view and
mobile screen subtasks. This task mirrors that template one-to-one for
the memory surface. Decomposing the macOS-side contract from the view
follows the same lesson the knowledge cluster encoded
(`.kota/runs/2026-04-26T12-34-47-932Z-builder-etzhhp` timed out at ~17
minutes when the contract layer plus SwiftUI view plus AppState wiring
plus operator capture were bundled into one builder run): keep the
typed contract task scoped to `Models.swift` + `DaemonClient.swift` +
`DaemonClientTests.swift` so the follow-up view subtask can focus on UI
behavior and operator capture without re-debating the daemon shape.

## Initiative

Operator-pull parity for the memory surface: every primary operator
client (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares one
search seam through `GET /api/memory/search`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication. This task lands the macOS-side daemon contract layer for
that seam.

## Acceptance Evidence

- Diff covering the new `MemoryEntry`, `MemorySearchResponse`, and
  `renderMemorySearchPlain` in `Models.swift`, the new
  `searchMemory(query:limit:)` method on `DaemonClient.swift`, and the
  four new `DaemonClientTests` cases.
- `swift test` output showing all four `searchMemory` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
