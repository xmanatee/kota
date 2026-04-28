---
id: task-add-macos-daemonclientcapture-with-discriminated-c
title: Add macOS DaemonClient.capture with discriminated CaptureResult types and unit tests
status: ready
priority: p2
area: client
summary: Wire the daemon contract layer for the cross-store capture seam into the macOS menu-bar client: add the discriminated CaptureRecord and CaptureResult unions to Models.swift, add a typed capture(text:target:hint:) method to DaemonClient.swift that targets POST /capture, mirror renderCaptureResultPlain in Swift, and pair the four DaemonClientTests cases (success memory + tasks arms, ambiguous, no_contributors, contributor_failed) so the follow-up macOS CaptureView and mobile CaptureScreen subtasks consume a tested seam.
created_at: 2026-04-28T04:52:11.259Z
updated_at: 2026-04-28T04:52:11.259Z
---

## Problem

The cross-store capture seam is now exposed on three operator surfaces:

- `kota capture` CLI (`src/modules/capture/cli.ts`).
- Daemon control route `POST /capture` plus its user-facing twin
  `POST /api/capture`, both sharing `createCaptureRouteHandler`
  (`src/modules/capture/routes.ts:43-72`); the route returns
  `{ ok: true, record: CaptureRecord } |
   { ok: false, reason: "ambiguous", suggestions: CaptureTarget[] } |
   { ok: false, reason: "no_contributors" } |
   { ok: false, reason: "contributor_failed", target: CaptureTarget,
     message: string }`
  so callers branch on each typed envelope rather than coercing the
  failure shape.
- Telegram `/capture <text>` plus the four explicit twins
  `/capture-to-{memory,knowledge,tasks,inbox}` (commit `d4c35d1e`),
  each rendered through `renderCaptureReplyPlain`
  (`src/modules/capture/render.ts`) over
  `ctx.client.capture.capture`.
- Web `CapturePanel` consuming `DaemonControlClient.capture.capture`
  (commit `d9d34b89`).

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`, `/tasks/search`, `/recall`, `/answer`, voice,
and chat — but no `capture()`. Without a typed Swift mirror and
`DaemonClient` method for the `/capture` route, no view layer in the
macOS client can consume the seam without scattering route strings,
JSON decoding, URL construction, and ad-hoc discriminated decoding
across views — which `clients/macos/AGENTS.md` explicitly forbids and
which the `recall` and `answer` predecessors deliberately avoided.

## Desired Outcome

`DaemonClient.capture(text:target:hint:)` exists and returns the
discriminated `CaptureResult`. `Models.swift` declares the Swift
mirrors of the four `CaptureRecord` arms in one discriminated union
plus the four-arm `CaptureResult` envelope, and ships a
`renderCaptureResultPlain` Swift helper that matches the TS render
byte-for-byte. The four `DaemonClientTests` cases prove the seam
against the daemon's exact response contract, including all three
typed `ok: false` branches plus a multi-arm success decode. The
follow-up macOS `CaptureView` and mobile `CaptureScreen` subtasks
can then consume a tested data layer with no further contract
decisions to make.

## Constraints

- Add `CaptureTarget` (a Swift `enum: String` mirror of the TS
  `"memory" | "knowledge" | "tasks" | "inbox"` union),
  `CaptureRecord` (a Swift discriminated representation — enum with
  associated values for the four arms `memory`, `knowledge`, `tasks`,
  `inbox`), and `CaptureResult` (a Swift discriminated representation
  — enum with associated values for the four arms `success`,
  `ambiguous`, `noContributors`, `contributorFailed`) to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly (success record carries the underlying
  store's typed identifier; tasks/inbox arms additionally carry the
  filesystem path the contributor minted; ambiguous arm carries the
  contributors the classifier considered; contributor_failed arm
  carries the chosen target and the error message). Use the same
  enum-with-associated-values style already used by
  `RecallSearchResponse` and `AnswerResponse` in the same file — do
  not flatten into a single struct with optional fields, do not
  invent a parallel response type that drifts from the daemon's
  contract.
- The four `CaptureRecord` arms carry exactly the fields the TS
  discriminated union declares in
  `src/core/server/kota-client.ts:760-797`:
  - `memory`: `recordId: String`.
  - `knowledge`: `recordId: String`.
  - `tasks`: `recordId: String`, `path: String`.
  - `inbox`: `recordId: String`, `path: String`.
  Decode discriminated by the wire `target` field. No nullable
  shape — every field is required on the daemon side.
- The four `CaptureResult` arms carry exactly the fields the TS
  discriminated union declares in
  `src/core/server/kota-client.ts:833-846`:
  - `success`: `record: CaptureRecord`.
  - `ambiguous`: `suggestions: [CaptureTarget]`.
  - `noContributors`: no payload.
  - `contributorFailed`: `target: CaptureTarget`, `message: String`.
  Decode discriminated by `ok` (success vs failure), then by
  `reason` for the three failure arms.
- Mirror `renderCaptureResultPlain` from
  `src/modules/capture/render.ts:25-50` as a Swift helper alongside
  `renderRecallHitsPlain` and the existing render mirrors so the
  macOS surface emits the same plain-text body as Telegram, the CLI,
  and any other surface that consumes the helper. Match the TS
  output byte-for-byte: success body is
  `Captured: <target>  <recordId>` for memory/knowledge and
  `Captured: <target>  <recordId>  <path>` for tasks/inbox; ambiguous
  body lists suggestions with the CLI `--target <one of: a, b, c>`
  hint; no-contributors body is the single unconfigured line;
  contributor-failed body renders the target and message verbatim.
  Do not mirror the chat-surface variant `renderCaptureReplyPlain` —
  that helper is Telegram-specific and the macOS surface uses the
  CLI/web body.
- Add a typed
  `capture(text: String, target: CaptureTarget?, hint: String?) async throws -> CaptureResult`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  Encode the request as a JSON body via `JSONEncoder` — the route
  is `POST /capture` (a daemon control route, not under `/api/`),
  with body `{ "text": <string>, "filter"?: { "target"?, "hint"? } }`
  matching `src/modules/capture/routes.ts:43-72`. Build the URL via
  `URLComponents` — do not concatenate raw strings. Send the bearer
  token from `daemon-control.json` the same way every other
  `DaemonClient` method does. Pattern the call after the existing
  `recall(query:topK:minScore:sources:)` method one-to-one but with
  the route adjusted to `/capture` and the parameters serialized
  into the JSON body's `text`/`filter` shape rather than
  `query`/`filter`.
- The optional filter fields collapse into the JSON body only when
  set: a nil `target` / `hint` omits that key entirely so the seam
  applies its own defaults (classifier picks the target; no hint
  passed to the prompt). Do not send `null` keys. When both are nil
  the request omits `filter` entirely.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder`
  and `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test
  target or fixture file. Cover exactly four cases:
  1. Multi-arm success payload exercising the `tasks` record
     (carries `path`) plus a second case decoding the `memory`
     arm (no `path`), so both record-shape variants are
     exercised. A single test that wires both decodes through the
     same harness is acceptable.
  2. `ambiguous` payload with at least two suggestions, asserting
     the suggestion order is preserved.
  3. `no_contributors` payload.
  4. `contributor_failed` payload with a non-empty `target` and
     `message`; the test asserts the `target` decodes as the
     correct `CaptureTarget` enum case.
- Cover one render path per arm in the same test file (or a
  sibling test) so the Swift `renderCaptureResultPlain` helper
  cannot drift from the TS output without failing.

## Done When

- `CaptureTarget`, `CaptureRecord` (discriminated), and
  `CaptureResult` (discriminated) exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the four-arm
  failure representation, plus a `renderCaptureResultPlain` Swift
  helper that mirrors `src/modules/capture/render.ts:25-50`.
- `DaemonClient.capture(text:target:hint:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `CaptureResult`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  has the four decode cases listed above plus per-arm render
  assertions and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped web `CapturePanel`
(commit `d9d34b89`), which landed alongside the cross-store capture
seam (`805a6edf`), the `kota capture` CLI subcommand, the daemon
`POST /capture` and `POST /api/capture` routes, the
`KotaClient.capture.capture` namespace, and the Telegram `/capture`
plus four `/capture-to-*` commands (`d4c35d1e`). The seam task
(`task-add-a-unified-cross-store-capture-seam-routing-one`)
explicitly scoped Telegram, web, macOS, and mobile adoption out of
the seam itself and called for them to land later as honest single-
task follow-ups. Telegram and web have landed; macOS and mobile
remain. The macOS DaemonClient contract task is the next single
substantive step; decomposing it from the view follows the lesson
the recall / answer / answer-history clusters encoded (separate
contract task → view task → mobile task, never bundled, because
bundling repeatedly timed out builder runs at ~17 minutes when the
contract layer plus SwiftUI view plus AppState wiring plus operator
capture were combined). This task mirrors the
`task-add-macos-daemonclientrecall-with-discriminated-re` template
one-to-one for the cross-store capture surface, with the route
adjusted from `POST /recall` to `POST /capture`, the request shape
adjusted from `{query, filter}` to `{text, filter}`, and the
response type adjusted to the four-arm discriminated `CaptureResult`
envelope.

## Initiative

Cross-store capture fan-out: deliver the unified capture seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single natural-language note is reachable wherever the operator
is observing or thinking. This task lands the macOS-side daemon
contract layer for that seam.

## Acceptance Evidence

- Diff covering the new `CaptureTarget`, `CaptureRecord`,
  `CaptureResult`, and `renderCaptureResultPlain` in `Models.swift`,
  the new `capture(text:target:hint:)` method on `DaemonClient.swift`,
  and the four new `DaemonClientTests` cases plus the per-arm render
  assertions.
- `swift test` output showing all four `capture` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
