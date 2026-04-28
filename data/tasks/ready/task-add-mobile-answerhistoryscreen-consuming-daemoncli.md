---
id: task-add-mobile-answerhistoryscreen-consuming-daemoncli
title: Add mobile AnswerHistoryScreen consuming DaemonClient answer-log and answer-show
status: ready
priority: p2
area: client
summary: Add an AnswerHistoryScreen to the mobile client that calls GET /api/answers and GET /api/answers/:id through new DaemonClient.answerLog and DaemonClient.answerShow methods, exposes log/show state on DaemonContext, and renders the AnswerHistoryEntry projection plus the discriminated AnswerHistoryRecord shape exhaustively, closing the answer-history fan-out across CLI, daemon HTTP, Telegram, Slack, web AnswerHistoryPanel, and mobile (macOS lands as a separate follow-up task).
created_at: 2026-04-28T08:34:44.893Z
updated_at: 2026-04-28T08:34:44.893Z
---

## Problem

The answer-history seam — the disk-backed `AnswerHistoryStore` plus the
`KotaClient.answer.log` / `KotaClient.answer.show` namespace — has now
fanned out to every operator surface except mobile and macOS:

- CLI (`kota answer log`, `kota answer show <id>`) at commit `21bdc367`.
- Daemon HTTP (`GET /api/answers`, `GET /api/answers/:id`, plus the
  control-plane twins) at commit `21bdc367`.
- Telegram (`/answer-log [N]`, `/answer-show <id>`) at commit `daa25e07`.
- Web `AnswerHistoryPanel` at commit `8e263891`.
- Slack-channel (`/answer-log`, `/answer-show`) at commit `819792e9`.

The full capture→answer→history pipeline test has now landed (commit
`1bafc23b`), proving the seam is wire-stable end-to-end. But the mobile
client only exposes `AnswerScreen` — the live-compose surface for
`POST /api/answer` — and has no surface for reading back the records the
seam persists. From the phone, the operator can ask one question and get
one cited answer, but cannot scroll through "what did I ask three days
ago?" or re-render any single past answer without dropping into the
Telegram chat or the web dashboard.

This is the same cross-surface gap the answer-history seam was built to
close, and mobile is the only registered operator surface (alongside
macOS, which lands as a separate follow-up task per the parent
`task-persist-cited-answer-envelopes-as-a-typed-answer-h`'s explicit
deferral) that still has zero answer-history readback.

## Desired Outcome

The mobile client gains an `AnswerHistoryScreen` — a navigation-mounted
screen mirroring the shape of `RecallScreen` / `AnswerScreen` /
`HistoryScreen` — plus the supporting `DaemonClient` methods, reducer
state, and tests:

- The mobile `DaemonClient` adds `answerLog(filter?)` (calls
  `GET /api/answers` with `limit` and `beforeId` query params) and
  `answerShow(id)` (calls `GET /api/answers/:id`) methods, returning the
  same typed shapes the CLI / web / Telegram / Slack surfaces consume:
  `AnswerHistoryListResult` (entries are `AnswerHistoryEntry` projections
  carrying the `ok: true { citationCount }` / `ok: false { reason }`
  discriminated `result` union) and `AnswerHistoryShowResult` (discriminated
  `{ ok: true, record: AnswerHistoryRecord }` / `{ ok: false, reason: "not_found" }`).
  Both methods reject malformed responses loudly, mirroring the existing
  mobile `recall()` and `answer()` decode discipline.
- Typed mirrors of `AnswerHistoryEntry`, `AnswerHistoryRecord`,
  `AnswerHistoryListResult`, and `AnswerHistoryShowResult` live in
  `clients/mobile/src/types.ts` next to the existing `AnswerResult` /
  `AnswerCitation` types.
- `DaemonContext` exposes `answerLogEntries`, `answerLogLoading`,
  `answerLogError`, `answerLogHasMore`, plus `answerShowRecord`,
  `answerShowLoading`, `answerShowError`, plus action functions
  `loadAnswerLog(opts?)`, `loadMoreAnswerLog()`, `openAnswerShow(id)`,
  and `closeAnswerShow()`. Reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts` for the new actions.
- `AnswerHistoryScreen.tsx` renders a two-mode view:
  - **Log mode** — newest-first listing of `AnswerHistoryEntry[]`. Each
    row shows the `createdAt` timestamp, an ok-or-reason badge using the
    same source-tint palette already used for `AnswerScreen` / `RecallScreen`
    where natural, the `citationCount` for `ok: true` rows and the
    `reason` literal (`no_hits` / `semantic_unavailable` /
    `synthesis_failed`) for `ok: false` rows, and a truncated `query`. A
    "load older" affordance pages by passing `beforeId` to
    `loadMoreAnswerLog()`. Pull-to-refresh re-issues
    `loadAnswerLog({ limit })` from the top. Empty history shows a single
    fixed message (`"No answers in history yet."`).
  - **Show mode** — full re-render of one selected `AnswerHistoryRecord`
    fetched through `openAnswerShow(id)`. Renders the discriminated
    `AnswerResult` exhaustively with no `default` branch, identical to
    how the existing `AnswerScreen` already renders a live response,
    plus a header line showing the record's `id` + `createdAt` + the
    original `query`. A back-affordance returns to the log view without
    re-fetching the list.
- Selecting a row in the log opens the show view for that id; the show
  view reuses the same exhaustive `AnswerResult` render the existing
  `AnswerScreen` already uses (one shared sub-component if natural,
  otherwise the same render shape — do not invent a second citation
  parser or a second prose layout).
- Wired into `clients/mobile/src/navigation/index.tsx` next to
  `AnswerScreen` so the live-compose and history-readback surfaces sit
  side by side in the tab bar.

The four operator-visible branches of the show-mode `AnswerResult`
surface one-to-one with the persisted contract:

- `ok: true`: composed answer body verbatim (preserving inline
  `[source:id]` markers) plus the per-citation list.
- `ok: false, reason: "no_hits"`: fixed notice — no thrown error.
- `ok: false, reason: "semantic_unavailable"`: fixed notice — never a
  silent degrade.
- `ok: false, reason: "synthesis_failed"`: fixed notice — never a thrown
  error.

The list-mode missing-id arm (`ok: false, reason: "not_found"` from
`answerShow`) renders a distinct fixed message.

## Constraints

- One mechanism. The screen consumes the existing
  `KotaClient.answer.log` / `answer.show` namespaces exactly the way
  the existing `AnswerScreen` consumes `KotaClient.answer.answer`. Do
  not introduce a second listing path, a second renderer, a second
  pagination shape, or a per-record fan-out into the underlying
  `RecallHit[]`. Listing pagination, the typed projection shape, and
  the discriminated `AnswerResult` union all come from the existing
  namespace.
- Strict typed protocols. The renderer consumes the seam's
  discriminated `AnswerResult` union exhaustively (`ok: true` and the
  three `ok: false` reasons) with no `default` branch, and consumes
  `AnswerHistoryEntry` / `AnswerHistoryRecord` directly without
  introducing optional-field shims. No `null | undefined` aliasing for
  the "no record" arm — `answerShow` already returns
  `{ ok: false, reason: "not_found" }` for missing ids and the screen
  renders that arm as a fixed message.
- Build on the existing `DaemonContext`, navigation map, mobile
  `DaemonClient`, and screen composition. Do not add a parallel state
  container, navigation stack, or HTTP client just for the answer-history
  surface.
- Reuse the same daemon HTTP routes the web / Slack / Telegram / CLI
  already consume (`GET /api/answers`, `GET /api/answers/:id`). Do not
  introduce a second answer-history route, response shape, or rendering
  helper on the mobile side.
- Mirror the macOS / web decode discipline once macOS lands the same
  endpoints: same projection shape, same loud rejection of unknown
  reasons or malformed records.
- Render the `ok: true` answer body verbatim — preserving inline
  `[source:id]` markers — instead of stripping or re-formatting them.
  The citation list is rendered alongside the body, not inlined into it.
  Reuse the existing `AnswerScreen` answer-body sub-component if natural.
- Match the per-store screen interaction discipline (pull-to-refresh
  re-runs the last list query, explicit loading / error / empty / quiet
  states, no eager fetch when the daemon is offline).
- Keep `AnswerHistoryScreen` visually consistent with the sibling
  pull-surfaces (`AnswerScreen`, `RecallScreen`, `HistoryScreen`,
  `MemoryScreen`, `KnowledgeScreen`, `TaskSearchScreen`) so the family
  feels uniform.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Single new screen + new `DaemonClient.answerLog` / `answerShow`
  methods + reducer + navigation edit. Do not refactor the seven
  sibling screens in this task.
- No web / Telegram / Slack / CLI / macOS changes in this task — those
  surfaces are already landed (web, Telegram, Slack, CLI) or land as
  separate follow-up tasks (macOS).
- Cost signals do not flow into the screen reply. Match the existing
  repo standing rule: no per-record cost surfaced into the list or
  show views.

## Done When

- `clients/mobile/src/screens/AnswerHistoryScreen.tsx` renders the
  `AnswerHistoryScreen`, registered in the navigation map and reachable
  alongside `AnswerScreen` / `RecallScreen` / `HistoryScreen` /
  `MemoryScreen` / `KnowledgeScreen` / `TaskSearchScreen`.
- The mobile `DaemonClient` adds `answerLog(filter?)` and
  `answerShow(id)` methods against `GET /api/answers` and
  `GET /api/answers/:id`, returning the same typed
  `AnswerHistoryListResult` and `AnswerHistoryShowResult` shapes the
  CLI / web / Slack / Telegram already consume, with typed mirrors in
  `clients/mobile/src/types.ts` for `AnswerHistoryEntry`,
  `AnswerHistoryRecord`, `AnswerHistoryListResult`, and
  `AnswerHistoryShowResult`.
- `DaemonContext` exposes `answerLogEntries`, `answerLogLoading`,
  `answerLogError`, `answerLogHasMore`, `answerShowRecord`,
  `answerShowLoading`, `answerShowError`, plus action functions
  `loadAnswerLog(opts?)`, `loadMoreAnswerLog()`, `openAnswerShow(id)`,
  `closeAnswerShow()`, with reducer coverage in
  `clients/mobile/src/__tests__/reducer.test.ts`.
- `clients/mobile/src/__tests__/AnswerHistoryScreen.test.tsx` covers:
  - Log mode rendering a typed `AnswerHistoryEntry[]` containing both
    `ok: true` and at least one `ok: false` arm (for each of
    `no_hits` / `semantic_unavailable` / `synthesis_failed`).
  - Show mode rendering an `AnswerHistoryRecord` for each of the four
    `AnswerResult` branches, including the header line for `id` +
    `createdAt` + `query`.
  - Empty-log and missing-id arms (each a distinct fixed message).
  - Click-through from a log row into show view, and the back
    affordance returning to the log without re-fetching.
  - The "load older" pagination call wiring `beforeId` correctly.
  - The empty-list / offline / network-error states.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds
  answer-log / answer-show success / not-found / unknown-reason /
  malformed-record / HTTP-error coverage in the same shape already in
  place for `recall`, `answer`, and the per-store searches.
- The mobile test command (`pnpm test` inside `clients/mobile/`) and
  the answer module's tests (`pnpm test src/modules/answer`) both pass
  cleanly; no other answer or recall fan-out tests regress.

## Source / Intent

Closing the multi-surface fan-out kicked off by the answer-history store
(commit `21bdc367`) and continued through Telegram `/answer-log` +
`/answer-show` (`daa25e07`), the web `AnswerHistoryPanel` (`8e263891`),
and the Slack-channel `/answer-log` + `/answer-show` parity (`819792e9`).
The parent task `task-persist-cited-answer-envelopes-as-a-typed-answer-h`
explicitly leaves macOS and mobile adoption as separate follow-up tasks;
the web AnswerHistoryPanel task body restated this. The full
capture→answer→history pipeline test (`1bafc23b`, completed 2026-04-28)
proves the seam is wire-stable end-to-end against the same backing
stores every operator surface consumes — landing the mobile readback
surface now is the natural next fan-out step before the cadence
CLI → daemon → Telegram → web → Slack → mobile is complete for the
answer-history seam. macOS is the remaining surface and lands as a
separate task pair (DaemonClient.answerLog / answerShow plus the
SwiftUI `AnswerHistoryView`).

## Initiative

Personal-assistant answering. KOTA should not just compose one cited
answer per query on every operator surface — the operator should be
able to read back past answers from the same surface they composed
them on. The mobile client is the natural next surface (after CLI,
Telegram, web, and Slack) for that readback because it is where the
operator already runs the live `AnswerScreen`, and a phone is the
single most common surface for "what did I ask three days ago?"
spot-checks during the day.

## Acceptance Evidence

- Diff covering the new `AnswerHistoryScreen.tsx`, the
  `DaemonClient.answerLog` / `answerShow` methods, the typed mirrors in
  `types.ts`, the reducer state and action additions, the navigation
  map edit, and the focused tests.
- Mobile test command output (`pnpm test` from `clients/mobile/`)
  showing the new `AnswerHistoryScreen` reducer, navigation, and
  daemon-client tests passing.
- A screenshot or transcript of the mobile `AnswerHistoryScreen`
  showing the log view rendering at least one `ok: true` and one
  `ok: false` row, plus the show view for an `ok: true` record with at
  least two citations across two source arms, plus one of the
  `ok: false` show arms.
- A short rendered-output sample (line shape) from the
  `AnswerHistoryScreen` log view next to the equivalent web
  `AnswerHistoryPanel` log row, the Telegram `/answer-log` reply, and
  the Slack `/answer-log` reply, proving the same projection shape
  flows through the same daemon route on every surface.
