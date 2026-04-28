---
id: task-add-macos-daemonclientretract-with-discriminated-r
title: Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
status: ready
priority: p2
area: client
summary: Wire the daemon contract layer for the cross-store retract seam into the macOS menu-bar client: add the discriminated RetractRecord and RetractResult unions to Models.swift, add a typed retract(request:) method to DaemonClient.swift that targets POST /retract, mirror renderRetractResultPlain in Swift, and pair the four DaemonClientTests cases (success across all four record arms, no_contributors, not_found, contributor_failed) so the follow-up macOS RetractView and mobile RetractScreen subtasks consume a tested seam.
created_at: 2026-04-28T12:05:48.826Z
updated_at: 2026-04-28T12:05:48.826Z
---

## Problem

The cross-store retract seam is now exposed on three operator surfaces:

- `kota retract` CLI (`src/modules/retract/cli.ts`).
- Daemon control route `POST /retract` plus its user-facing twin
  `POST /api/retract`, both sharing `createRetractRouteHandler`
  (`src/modules/retract/routes.ts:65-93`); the route returns
  `{ ok: true, record: RetractRecord } |
   { ok: false, reason: "no_contributors" } |
   { ok: false, reason: "not_found", target: RetractTarget,
     identifier: string } |
   { ok: false, reason: "contributor_failed", target: RetractTarget,
     message: string }`
  so callers branch on each typed envelope rather than coercing the
  failure shape.
- Telegram `/retract-<store>` commands (commit `9ba14254`), each
  rendered through `renderRetractResultPlain`
  (`src/modules/retract/render.ts`) over `ctx.client.retract.retract`.
- Web `RetractPanel` consuming `DaemonControlClient.retract.retract`
  (commit `e24bf8e3`).

The macOS menu bar client (`clients/macos/Sources/KotaMenuBar/`) has
typed `DaemonClient` methods for `/status`, `/approvals`,
`/owner-questions`, `/tasks`, `/sessions`, `/api/digest`,
`/api/attention`, `/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`, `/tasks/search`, `/recall`, `/answer`,
`/capture`, voice, and chat — but no `retract()`. Without a typed
Swift mirror and `DaemonClient` method for the `/retract` route, no
view layer in the macOS client can consume the seam without
scattering route strings, JSON encoding, URL construction, and ad-hoc
discriminated decoding across views — which `clients/macos/AGENTS.md`
explicitly forbids and which the `recall`, `answer`, and `capture`
predecessors deliberately avoided.

## Desired Outcome

`DaemonClient.retract(request:)` exists and returns the discriminated
`RetractResult`. `Models.swift` declares the Swift mirrors of the four
`RetractRecord` arms in one discriminated union plus the four-arm
`RetractResult` envelope, and ships a `renderRetractResultPlain` Swift
helper that matches the TS render byte-for-byte. The
`DaemonClientTests` cases prove the seam against the daemon's exact
response contract, including all three typed `ok: false` branches plus
a multi-arm success decode covering every `RetractRecord` arm. The
follow-up macOS `RetractView` and mobile `RetractScreen` subtasks can
then consume a tested data layer with no further contract decisions
to make.

## Constraints

- Add `RetractTarget` (a Swift `enum: String` mirror of the TS
  `"memory" | "knowledge" | "tasks" | "inbox"` union),
  `RetractRequest` (a Swift discriminated representation — enum with
  associated values for the four arms `memory(id:)`,
  `knowledge(slug:)`, `tasks(id:)`, `inbox(path:)`), `RetractRecord`
  (a Swift discriminated representation — enum with associated values
  for the four arms `memory`, `knowledge`, `tasks`, `inbox`), and
  `RetractResult` (a Swift discriminated representation — enum with
  associated values for the four arms `success`, `noContributors`,
  `notFound`, `contributorFailed`) to
  `clients/macos/Sources/KotaMenuBar/Models.swift`. Mirror the daemon
  route response shape exactly:
  - `memory` record carries `recordId: String`.
  - `knowledge` record carries `recordId: String`.
  - `tasks` record carries `recordId: String`,
    `previousPath: String`, `path: String`, `toState: "dropped"`.
  - `inbox` record carries `recordId: String`, `path: String`.
  Use the same enum-with-associated-values style already used by
  `RecallSearchResponse`, `AnswerResponse`, and `CaptureResult` in the
  same file — do not flatten into a single struct with optional
  fields, do not invent a parallel response type that drifts from the
  daemon's contract.
- The four `RetractResult` arms carry exactly the fields the TS
  discriminated union declares in
  `src/core/server/kota-client.ts:956-970`:
  - `success`: `record: RetractRecord`.
  - `noContributors`: no payload.
  - `notFound`: `target: RetractTarget`, `identifier: String`.
  - `contributorFailed`: `target: RetractTarget`, `message: String`.
  Decode discriminated by `ok` (success vs failure), then by `reason`
  for the three failure arms.
- Mirror `renderRetractResultPlain` from
  `src/modules/retract/render.ts:23-48` as a Swift helper alongside
  `renderRecallHitsPlain`, `renderAnswerResponsePlain`, and
  `renderCaptureResultPlain` so the macOS surface emits the same
  plain-text body as Telegram, the CLI, and any other surface that
  consumes the helper. Match the TS output byte-for-byte:
  - Success body for `memory`/`knowledge` is
    `Retracted: <target>  <recordId>`.
  - Success body for `tasks` is
    `Retracted: tasks  <recordId>  <previousPath> -> <path> (<toState>)`
    so the surface reads "moved to dropped", not "deleted".
  - Success body for `inbox` is
    `Retracted: inbox  <recordId>  <path>`.
  - `no_contributors` body is the single fixed line
    "Cross-store retract has no registered contributors for the named target.".
  - `not_found` body is
    `Retract <target>: no record with identifier "<identifier>".`.
  - `contributor_failed` body is
    `Retract from <target> failed: <message>`.
- Add a typed
  `retract(request: RetractRequest) async throws -> RetractResult`
  method to `clients/macos/Sources/KotaMenuBar/DaemonClient.swift`.
  Encode the request as a JSON body via `JSONEncoder` — the route
  is `POST /retract` (a daemon control route, not under `/api/`),
  with body `{ "target": <string>, ...per-target identifier }`
  matching `src/modules/retract/routes.ts:65-93`. Build the URL via
  `URLComponents` — do not concatenate raw strings. Send the bearer
  token from `daemon-control.json` the same way every other
  `DaemonClient` method does. Pattern the call after the existing
  `capture(text:target:hint:)` method one-to-one but with the route
  adjusted to `/retract` and the parameters serialized into the JSON
  body's discriminated `{target, id|slug|path}` shape rather than
  `{text, filter}`.
- The `retract` method takes a single `RetractRequest` parameter
  rather than a flattened keyword list, so the type system rejects a
  memory `id` being passed alongside an inbox `path` at compile time.
  No nullable identifier fields on the wire — every arm carries
  exactly its required identifier.
- Surface the daemon's typed error one-to-one when the route fails
  (HTTP error path matches the pattern other `DaemonClient` methods
  already use); do not swallow, retry, or coerce.
- Do not add a Swift Package dependency. Decode via `JSONDecoder`
  and `Codable`.
- Tests live in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  alongside the existing patterns; do not introduce a new test
  target or fixture file. Cover exactly four cases:
  1. Multi-arm success payload exercising all four `RetractRecord`
     arms (memory + knowledge with bare `recordId`, tasks with
     `previousPath`/`path`/`toState`, inbox with `path`), so every
     record-shape variant is exercised. A single test that wires
     all four decodes through the same harness is acceptable.
  2. `no_contributors` payload.
  3. `not_found` payload with a non-empty `target` and `identifier`;
     the test asserts the `target` decodes as the correct
     `RetractTarget` enum case and the identifier decodes verbatim.
  4. `contributor_failed` payload with a non-empty `target` and
     `message`; the test asserts the `target` decodes as the correct
     `RetractTarget` enum case.
- Cover one render path per arm in the same test file (or a sibling
  test) so the Swift `renderRetractResultPlain` helper cannot drift
  from the TS output without failing.

## Done When

- `RetractTarget`, `RetractRequest` (discriminated), `RetractRecord`
  (discriminated), and `RetractResult` (discriminated) exist in
  `clients/macos/Sources/KotaMenuBar/Models.swift` with the four-arm
  failure representation, plus a `renderRetractResultPlain` Swift
  helper that mirrors `src/modules/retract/render.ts:23-48`.
- `DaemonClient.retract(request:)` exists in
  `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` and returns
  `RetractResult`.
- `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  has the four decode cases listed above plus per-arm render
  assertions and passes.
- `swift build` and `swift test` are green for the macOS client.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0 at trigger
`autonomy.queue.empty`) follows the just-shipped web `RetractPanel`
(commit `e24bf8e3`), which landed the third operator surface for the
cross-store retract seam (`546cacab`) after the `kota retract` CLI
subcommand, the daemon `POST /retract` and `POST /api/retract`
routes, the `KotaClient.retract.retract` namespace, the agent-callable
`retract` tool, and the Telegram `/retract-<store>` commands
(`9ba14254`). The seam task
(`task-add-a-unified-cross-store-retract-seam-mirroring-c`)
explicitly scoped Telegram, web, macOS, and mobile adoption out of
the seam itself and called for them to land later as honest single-
task follow-ups (see the "No fan-out from this module" boundary in
`src/modules/retract/AGENTS.md`). Telegram and web have landed;
macOS and mobile remain. The macOS DaemonClient contract task is the
next single substantive step; decomposing it from the view follows
the lesson the recall / answer / answer-history / capture clusters
encoded (separate contract task → view task → mobile task, never
bundled, because bundling repeatedly timed out builder runs at ~17
minutes when the contract layer plus SwiftUI view plus AppState
wiring plus operator capture were combined). This task mirrors the
`task-add-macos-daemonclientcapture-with-discriminated-c` template
one-to-one for the cross-store retract surface, with the route
adjusted from `POST /capture` to `POST /retract`, the request shape
adjusted from `{text, filter}` to the discriminated
`{target, id|slug|path}` shape, and the response type adjusted to the
four-arm discriminated `RetractResult` envelope.

## Initiative

Cross-store retract fan-out: deliver the unified retract seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single typed correction entry is reachable wherever the operator
is watching, mirroring the capture, recall, and answer chains already
fanned out across the same surfaces. This task lands the macOS-side
daemon contract layer for that seam.

## Acceptance Evidence

- Diff covering the new `RetractTarget`, `RetractRequest`,
  `RetractRecord`, `RetractResult`, and `renderRetractResultPlain` in
  `Models.swift`, the new `retract(request:)` method on
  `DaemonClient.swift`, and the four new `DaemonClientTests` cases
  plus the per-arm render assertions.
- `swift test` output showing the new `retract` cases passing
  alongside the existing `DaemonClientTests` suite, captured under
  `.kota/runs/<run-id>/`.
