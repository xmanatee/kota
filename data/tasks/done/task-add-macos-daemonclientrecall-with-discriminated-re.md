---
id: task-add-macos-daemonclientrecall-with-discriminated-re
title: Add macOS DaemonClient.recall with discriminated RecallSearchResponse types and unit tests
status: done
priority: p2
area: client
summary: Wire the daemon contract layer for the cross-store recall seam into the macOS menu-bar client: add the discriminated RecallHit union and RecallSearchResponse to Models.swift, add a typed recall(query:topK:minScore:sources:) method to DaemonClient.swift that targets POST /recall, mirror renderRecallHitsPlain in Swift, and pair the four DaemonClientTests cases (mixed-source success, empty hits, ok:false semantic-unavailable, typed HTTP error) so the follow-up macOS RecallView and mobile RecallScreen subtasks consume a tested seam.
created_at: 2026-04-27T08:49:32.359Z
updated_at: 2026-04-27T08:55:07.157Z
---

## Problem

The cross-store recall seam is now exposed on three operator surfaces:

- `kota recall` CLI (`src/modules/recall/cli.ts`).
- Daemon control route `POST /recall` plus its user-facing twin
  `POST /api/recall`, both sharing `createRecallRouteHandler`
  (`src/modules/recall/routes.ts:50-86`); the route returns
  `{ ok: true, hits: RecallHit[] } | { ok: false, reason: "semantic_unavailable" }`
  so callers do not silently degrade to keyword search behind the
  operator's back.
- Telegram `/recall <query>` command, rendered via the shared
  `renderRecallHitsPlain` helper (`src/modules/recall/render.ts`)
  through `ctx.client.recall.recall` (commit `6510f998`).
- Web `RecallPanel` consuming `DaemonControlClient.recall.recall`
  (commit `9a96682a`).

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`, `/tasks/search`, voice, and chat — but no
`recall()`. Without a typed Swift mirror and `DaemonClient` method
for the `/recall` route, no view layer in the macOS client can
consume the seam without scattering route strings, JSON decoding,
URL construction, and ad-hoc discriminated decoding across views —
which `clients/macos/AGENTS.md` explicitly forbids and which the
`searchKnowledge`, `searchMemory`, `searchHistory`, and `searchTasks`
predecessors deliberately avoided.

## Desired Outcome

`DaemonClient.recall(query:topK:minScore:sources:)` exists and
returns the discriminated `RecallSearchResponse`. `Models.swift`
declares the Swift mirrors of the four `RecallHit` arms in one
discriminated union plus the `ok: true | false` response shape, and
ships a `renderRecallHitsPlain` Swift helper that matches the
TS render byte-for-byte. The four `DaemonClientTests` cases prove
the seam against the daemon's exact response contract, including
the `ok: false` semantic-unavailable branch and the typed HTTP error
path. The follow-up macOS `RecallView` and mobile `RecallScreen`
subtasks can then consume a tested data layer with no further
contract decisions to make.

## Constraints

- Add `RecallHit` (a Swift discriminated representation — enum with
  associated values for the four arms `knowledge`, `memory`,
  `history`, `tasks`) and `RecallSearchResponse` to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly: `{ ok: true, hits: RecallHit[] }`
  on success and `{ ok: false, reason: "semantic_unavailable" }`
  when the recall provider has no registered contributors. Use the
  same enum-with-associated-values style already used by
  `KnowledgeSearchResponse`, `MemorySearchResponse`,
  `HistorySearchResponse`, and `TasksSearchResponse` in the same
  file — do not flatten into a single struct with optional fields,
  do not invent a parallel response type that drifts from the
  daemon's contract.
- The four `RecallHit` arms carry exactly the fields the TS
  discriminated union declares in
  `src/core/server/kota-client.ts:533-571`:
  - `knowledge`: `score: Double`, `id: String`, `title: String`,
    `preview: String`, `updated: String`.
  - `memory`: `score: Double`, `id: String`, `preview: String`,
    `created: String`.
  - `history`: `score: Double`, `id: String`, `title: String`,
    `cwd: String`, `updatedAt: String`.
  - `tasks`: `score: Double`, `id: String`, `title: String`,
    `state: String`, `priority: String`, `updatedAt: String`.
  Decode discriminated by the wire `source` field. No nullable
  shape — every field is required on the daemon side.
- Mirror `renderRecallHitsPlain` from `src/modules/recall/render.ts`
  as a Swift helper alongside `renderKnowledgeSearchPlain`,
  `renderMemorySearchPlain`, `renderHistorySearchPlain`, and
  `renderRepoTaskSearchPlain` so the macOS surface emits the same
  source / score / id / per-source-title line shape as Telegram,
  the CLI, and any other surface that consumes the helper. Match
  `src/modules/recall/render.ts:30-44` exactly: source column pads
  to the widest source (minimum width 6), id column pads to the
  widest id (minimum width 2), score column is 5 chars wide
  (`0.xxx` with three-decimal precision, right-padded), columns
  are joined by two spaces, the per-source title is taken from the
  arm-specific helper (`title` for knowledge/history,
  `preview` for memory, `[state/priority] title` for tasks).
- Add a typed
  `recall(query: String, topK: Int?, minScore: Double?, sources: [String]?) async throws -> RecallSearchResponse`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  Encode the request as a JSON body via `JSONEncoder` — the route
  is `POST /recall` (a daemon control route, not under `/api/`),
  with body `{ "query": <string>, "filter": { "topK"?, "minScore"?,
  "sources"? } }` matching `src/modules/recall/routes.ts:50-86`.
  Build the URL via `URLComponents` — do not concatenate raw
  strings. Send the bearer token from `daemon-control.json` the
  same way every other `DaemonClient` method does. Pattern the
  call after the existing `searchTasks(query:limit:states:)` method
  one-to-one but with the route adjusted to `/recall`, the HTTP
  method to `POST`, and the parameters serialized into the JSON
  body rather than the query string.
- The optional filter fields collapse into the JSON body only when
  set: a nil `topK` / `minScore` / `sources` omits that key entirely
  so the seam applies its own typed defaults
  (`RECALL_DEFAULT_TOP_K = 20`, no min-score floor, every registered
  contributor). Do not send `null` keys.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder`
  and `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test
  target or fixture file. Cover exactly four cases:
  1. Mixed-source success payload (`ok: true`, hits from at least
     two of the four `source` arms, exercising the discriminated
     decoder against every arm's per-source fields).
  2. Empty hits payload (`ok: true`, empty hits).
  3. `ok: false` semantic-unavailable payload.
  4. Typed HTTP error path (route returns non-200).

## Done When

- `RecallHit` (discriminated) and `RecallSearchResponse` exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the
  discriminated `ok: true | false` representation, plus a
  `renderRecallHitsPlain` Swift helper that mirrors
  `src/modules/recall/render.ts:30-44`.
- `DaemonClient.recall(query:topK:minScore:sources:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `RecallSearchResponse`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  has the four cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped web `RecallPanel`
(commit `9a96682a`), which landed alongside the cross-store recall
seam (`09d60ce3`), the `kota recall` CLI subcommand, the daemon
`POST /recall` and `POST /api/recall` routes, the
`KotaClient.recall.recall` namespace, the Telegram `/recall`
command (`6510f998`), and now the web client. The seam task
(`task-add-a-unified-cross-store-recall-seam-returning-ra`)
explicitly scoped Telegram, macOS, mobile, and web adoption out of
the seam itself and called for them to land later as honest single-
task follow-ups. Telegram and web have landed; macOS and mobile
remain. The macOS DaemonClient contract task is the next single
substantive step; decomposing it from the view follows the lesson
the knowledge / memory / history / tasks-semantic clusters encoded
(separate contract task → view task → mobile task, never bundled,
because bundling repeatedly timed out builder runs at ~17 minutes
when the contract layer plus SwiftUI view plus AppState wiring plus
operator capture were combined). This task mirrors the
`task-add-macos-daemonclientsearchtasks-with-discriminat` template
one-to-one for the cross-store recall surface, with the route
adjusted from `GET /tasks/search?...` to `POST /recall` (JSON body)
and the response type adjusted to the four-arm discriminated
`RecallHit` union.

## Initiative

Cross-store recall fan-out: deliver the unified recall seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single natural-language query is reachable wherever the
operator is watching. This task lands the macOS-side daemon contract
layer for that seam.

## Acceptance Evidence

- Diff covering the new `RecallHit` discriminated representation,
  `RecallSearchResponse`, and `renderRecallHitsPlain` in
  `Models.swift`, the new `recall(query:topK:minScore:sources:)`
  method on `DaemonClient.swift`, and the four new
  `DaemonClientTests` cases.
- `swift test` output showing all four `recall` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
