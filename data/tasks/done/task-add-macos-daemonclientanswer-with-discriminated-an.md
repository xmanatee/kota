---
id: task-add-macos-daemonclientanswer-with-discriminated-an
title: Add macOS DaemonClient.answer with discriminated AnswerResult types and unit tests
status: done
priority: p2
area: client
summary: Wire the daemon contract layer for the cited-answer seam into the macOS menu-bar client: add the AnswerCitation struct and discriminated AnswerResult union to Models.swift, add a typed answer(query:topK:minScore:sources:) method to DaemonClient.swift that targets POST /answer, mirror renderAnswerCitationsPlain in Swift, and pair the five DaemonClientTests cases (synthesized success spanning two source arms, no_hits, semantic_unavailable, synthesis_failed, typed HTTP error) so the follow-up macOS AnswerView and mobile AnswerScreen subtasks consume a tested seam.
created_at: 2026-04-27T12:17:25.429Z
updated_at: 2026-04-27T12:23:48.103Z
---

## Problem

The cited-answer seam is now exposed on three operator surfaces:

- `kota answer <query>` CLI subcommand (`src/modules/answer/cli.ts`).
- Daemon control route `POST /answer` plus its user-facing twin
  `POST /api/answer`, both sharing `createAnswerRouteHandler`
  (`src/modules/answer/routes.ts:48-102`); the route returns the
  discriminated `AnswerResult` —
  `{ ok: true, answer, citations, hits } |
   { ok: false, reason: "no_hits" | "semantic_unavailable" | "synthesis_failed" }`
  (`src/core/server/kota-client.ts:662-672`) — so callers cannot
  silently degrade or hallucinate citations behind the operator's back.
- Telegram `/answer <query>` command (commit `82a544af`) and web
  `AnswerPanel` (commit `1d3dcefb`), both consuming
  `ctx.client.answer.answer` and `DaemonControlClient.answer.answer`
  respectively, with no second prompt, second parser, or second retry.

The macOS menu-bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`, `/tasks/search`, `/recall`, voice, and chat —
but no `answer()`. Without a typed Swift mirror of `AnswerCitation`,
`AnswerResult`, and a `DaemonClient.answer` method for the `/answer`
route, no view layer in the macOS client can consume the seam without
scattering route strings, JSON decoding, URL construction, and ad-hoc
discriminated decoding across views — which `clients/macos/AGENTS.md`
explicitly forbids and which the `searchKnowledge`, `searchMemory`,
`searchHistory`, `searchTasks`, and `recall` predecessors deliberately
avoided.

## Desired Outcome

`DaemonClient.answer(query:topK:minScore:sources:)` exists and returns
the discriminated `AnswerResult`. `Models.swift` declares the Swift
mirror of `AnswerCitation` plus the four-branch `AnswerResult`
discriminated union (one `ok: true` arm carrying `answer: String`,
`citations: [AnswerCitation]`, `hits: [RecallHit]`; three `ok: false`
arms tagged by `reason`). `Models.swift` also ships a
`renderAnswerCitationsPlain` Swift helper that matches the TS render
byte-for-byte (`src/modules/answer/render.ts:32-53`). The five
`DaemonClientTests` cases prove the seam against the daemon's exact
response contract, including each `ok: false` reason and the typed
HTTP error path. The follow-up macOS `AnswerView` and mobile
`AnswerScreen` subtasks can then consume a tested data layer with no
further contract decisions to make.

## Constraints

- Add `AnswerCitation` (a Swift struct mirroring
  `{ source: RecallSource, id: String }` from
  `src/core/server/kota-client.ts:642-645`) and `AnswerResult` (a Swift
  enum with associated values, four arms total) to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly:
  - `ok: true` carries `answer: String`, `citations: [AnswerCitation]`,
    `hits: [RecallHit]` — the existing `RecallHit` discriminated enum
    on the macOS side already mirrors the four-arm union; reuse it
    rather than duplicating per-source structs.
  - `ok: false` discriminates by `reason` over `"no_hits"`,
    `"semantic_unavailable"`, and `"synthesis_failed"` (an enum
    associated with the failure arm — do not flatten into a string).
  Use the same enum-with-associated-values style already used by
  `RecallSearchResponse`, `KnowledgeSearchResponse`,
  `MemorySearchResponse`, `HistorySearchResponse`, and
  `TasksSearchResponse` in the same file — do not flatten into a single
  struct with optional fields, do not invent a parallel response type
  that drifts from the daemon's contract.
- Citation `source` decodes to the same `RecallSource` representation
  the existing `RecallHit` arms use on the macOS side. No nullable
  shape — every field is required on the daemon side.
- Mirror `renderAnswerCitationsPlain` from `src/modules/answer/render.ts`
  as a Swift helper alongside `renderRecallHitsPlain`,
  `renderKnowledgeSearchPlain`, `renderMemorySearchPlain`,
  `renderHistorySearchPlain`, and `renderRepoTaskSearchPlain` so the
  macOS surface emits the same source / score / id / per-source-title
  line shape every other surface that consumes the helper does. Match
  `src/modules/answer/render.ts:32-53` exactly: source column pads to
  the widest source (minimum width 6), id column pads to the widest id
  (minimum width 2), score column is 5 chars wide (`0.xxx` with three-
  decimal precision, right-padded), columns are joined by two spaces,
  the per-source title is taken from the arm-specific helper (`title`
  for knowledge/history, `preview` for memory,
  `[state/priority] title` for tasks). Citations whose `{ source, id }`
  do not appear in `hits` are dropped; an empty resolved-row list
  returns the empty string, exactly like the TS helper.
- Add a typed
  `answer(query: String, topK: Int?, minScore: Double?, sources: [String]?) async throws -> AnswerResult`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  Encode the request as a JSON body via `JSONEncoder` — the route is
  `POST /answer` (a daemon control route, not under `/api/`), with
  body `{ "query": <string>, "filter": { "topK"?, "minScore"?,
  "sources"? } }` matching `src/modules/answer/routes.ts:48-77`. Build
  the URL via `URLComponents` — do not concatenate raw strings. Send
  the bearer token from `daemon-control.json` the same way every other
  `DaemonClient` method does. Pattern the call after the existing
  `recall(query:topK:minScore:sources:)` method one-to-one but with
  the route adjusted to `/answer` and the response type adjusted to
  `AnswerResult`.
- The optional filter fields collapse into the JSON body only when
  set: a nil `topK` / `minScore` / `sources` omits that key entirely
  so the seam applies its own typed defaults. Do not send `null` keys.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder` and
  `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test target
  or fixture file. Cover exactly five cases:
  1. Synthesized-success payload (`ok: true`) with citations spanning
     at least two of the four `RecallHit` arms, exercising the
     discriminated decoder against every arm's per-source fields and
     the `[source:id]` markers preserved verbatim in `answer`.
  2. `ok: false, reason: "no_hits"` payload.
  3. `ok: false, reason: "semantic_unavailable"` payload.
  4. `ok: false, reason: "synthesis_failed"` payload.
  5. Typed HTTP error path (route returns non-200).

## Done When

- `AnswerCitation` and the four-arm discriminated `AnswerResult` exist
  in `clients/macos/Sources/KotaMenuBar/Models.swift` with the same
  enum-with-associated-values style as `RecallSearchResponse`, plus a
  `renderAnswerCitationsPlain` Swift helper that mirrors
  `src/modules/answer/render.ts:32-53` byte-for-byte against shared
  inputs.
- `DaemonClient.answer(query:topK:minScore:sources:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `AnswerResult`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift` has
  the five cases listed above and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped web `AnswerPanel`
(commit `1d3dcefb`), which landed alongside the cited-answer seam
(commit `082c565f` — `AnswerProvider`, `POST /answer` and
`POST /api/answer` routes, `KotaClient.answer.answer` namespace,
`kota answer` CLI), the Telegram `/answer` command (`82a544af`), and
now the web client. The seam task
(`task-add-a-cited-answer-seam-on-top-of-cross-store-reca`) explicitly
scoped Telegram, macOS, mobile, and web adoption out of the seam itself
and called for them to land later as honest single-task follow-ups.
Telegram and web have landed; macOS and mobile remain. The macOS
DaemonClient contract task is the next single substantive step;
decomposing it from the view follows the lesson the knowledge / memory
/ history / tasks-semantic / cross-store recall clusters all encoded
(separate contract task → view task → mobile task, never bundled,
because bundling repeatedly timed out builder runs at ~17 minutes when
the contract layer plus SwiftUI view plus AppState wiring plus
operator capture were combined). This task mirrors the
`task-add-macos-daemonclientrecall-with-discriminated-re` template
one-to-one for the cited-answer surface, with the route adjusted from
`POST /recall` to `POST /answer` and the response type adjusted from
the four-arm `RecallSearchResponse` to the four-arm `AnswerResult`
(one synthesized success arm plus three discriminated failure reasons).

## Initiative

Personal-assistant answering. KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain on every operator surface, not just the CLI, Telegram, and web.
The macOS menu bar is the natural third surface — the same place the
operator already runs `/recall` from a menu-bar view — and lands the
contract layer the macOS `AnswerView` and mobile `AnswerScreen` will
both consume.

## Acceptance Evidence

- Diff covering the new `AnswerCitation`, four-arm `AnswerResult`, and
  `renderAnswerCitationsPlain` in `Models.swift`, the new
  `answer(query:topK:minScore:sources:)` method on `DaemonClient.swift`,
  and the five new `DaemonClientTests` cases.
- `swift test` output showing all five `answer` cases passing alongside
  the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
