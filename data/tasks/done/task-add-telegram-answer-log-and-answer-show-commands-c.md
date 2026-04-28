---
id: task-add-telegram-answer-log-and-answer-show-commands-c
title: Add Telegram /answer-log and /answer-show commands consuming the answer-history seam
status: done
priority: p2
area: modules
summary: Add Telegram /answer-log [N] (newest-first listing) and /answer-show <id> (full re-render) commands that consume KotaClient.answer.log/show, so chat operators can re-read past synthesized answers from the same surface where most ad-hoc /answer queries originate. Honest single-surface follow-up of the answer-history store; web, macOS, and mobile adoption land later as separate tasks.
created_at: 2026-04-28T00:49:45.485Z
updated_at: 2026-04-28T01:05:42.155Z
---

## Problem

The answer-history store landed at commit `21bdc367` with the typed
`AnswerHistoryRecord` shape, a disk-backed store under
`<projectStateRoot>/answer-history/`, append-on-every-arm wiring inside
`AnswerProviderImpl`, the `kota answer log` / `kota answer show <id>`
CLI subcommands, the `GET /api/answers` + `GET /api/answers/:id`
daemon routes (with control-plane twins), and the
`KotaClient.answer.log` / `KotaClient.answer.show` namespace methods.
The seam intentionally shipped without channel/client adoption so it
would not seed another four-surface fan-out chain (see the
`## Initiative` section of
`task-persist-cited-answer-envelopes-as-a-typed-answer-h.md`).

Telegram already exposes `/answer <query>` (commit `82a544af`) — a
chat-side composed-answer entry point that is now where most ad-hoc
synthesized answers originate, because chat is where one-shot personal-
assistant queries actually start (most often from a phone). What it
does not yet expose is any read access into what `/answer` produced
yesterday or last week. From chat the operator can compose new
answers but cannot scroll back to "what did I ask three days ago?"
without leaving the chat surface and dropping to `kota answer log` on
a terminal. That breaks the personal-assistant promise on the surface
that benefits most from it: chat is the natural place to re-read
yesterday's answer about a meeting, a person, or a project.

## Desired Outcome

- The Telegram channel exposes two new commands, registered alongside
  the existing `/recall`, `/knowledge`, `/memory`, `/history`,
  `/tasks`, and `/answer` commands and gated by the same chat
  allowlist:
  - `/answer-log [N]` — newest-first listing of past answer envelopes.
    `N` is an optional integer count, default a small fixed value
    (e.g. 5) matching the CLI default. Each row renders the timestamp,
    the ok/reason badge, the citation count for `ok: true` rows and
    the failure reason for `ok: false` rows, and a truncated query —
    the same one-line projection `kota answer log` already produces.
  - `/answer-show <id>` — full re-render of one stored record by id,
    using the same prose-plus-citation-list shape `/answer <query>`
    already emits live, so a stored record renders identically to the
    answer the operator originally received.
- Both commands are thin wrappers over
  `ctx.client.answer.log(options?)` and `ctx.client.answer.show(id)`.
  The Telegram module does not introduce a second listing path, a
  second renderer, or a per-record fan-out into the underlying
  `RecallHit[]`. Listing pagination, the typed projection shape, and
  the discriminated `AnswerResult` union all come from the existing
  namespace.
- `/answer-show` of an unknown id emits one fixed-body "not found"
  message; the seam already returns a typed not-found envelope, so the
  Telegram handler renders that envelope and does not throw.
- `/answer-log` over an empty store emits one fixed-body "no past
  answers" message rather than an empty bullet list, matching the
  existing pattern of `/recall` and the per-store search commands when
  they have nothing to render.
- `/answer` stays as-is and is the only path that *creates* records.
  `/answer-log` and `/answer-show` are read-only — they never call the
  synthesizer, never spend a model call, and never mutate the store.

## Constraints

- **One mechanism.** The commands consume the existing `answer`
  namespace on `KotaClient`; they do not introduce a second listing
  path, a second renderer, a second pagination scheme, or a parallel
  on-disk read of `<projectStateRoot>/answer-history/`. The store is
  reached only through the typed namespace, exactly like `/answer`
  reaches the synthesizer only through `KotaClient.answer.answer`.
- **Strict typed protocols.** The renderer consumes the seam's
  discriminated `AnswerResult` union exhaustively for `/answer-show`
  (`ok: true` and the three `ok: false` reasons) with no `default`
  branch, and the typed `AnswerHistoryEntry[]` projection exhaustively
  for `/answer-log`. No optional fields, no silent fallbacks, no
  defensive re-shaping in the Telegram layer.
- **Reuse the existing renderer.** If a typed plain-text helper from
  the answer module already renders the citation block (see
  `renderAnswerCitationsPlain` in `src/modules/answer/render.ts`,
  already imported by `status-poll.ts` for `/answer`), `/answer-show`
  reuses it directly. If a list-row helper does not yet exist, add
  one inside `src/modules/answer/render.ts` and reuse it from both the
  CLI and Telegram layers — do not maintain two row formats.
- **Module boundary.** The Telegram module must not import from
  `#modules/answer` for runtime behavior beyond the typed
  `KotaClient.answer` namespace and any plain-text render helpers
  already consumed for `/answer`. The existing `answer` entry in
  `KotaModule.dependencies` (`src/modules/telegram/index.ts`) covers
  the shared render helpers; do not introduce additional cross-module
  runtime imports.
- **Chat-allowlist gating only.** Do not gate `/answer-log` or
  `/answer-show` behind quiet hours or any notification governance —
  these are pull/read actions initiated by the operator, not pushes,
  matching `/answer`, `/recall`, and the per-store search commands.
- **No model calls and no autonomy cost surfacing.** Both commands
  are pure reads. Do not synthesize a fresh prose answer when
  re-rendering, do not retry through the model, and do not surface
  per-record token usage or model-id back into the chat reply.
  Standing autonomy rule.
- **Splitting long replies.** `/answer-show` may emit a long body
  with many citations. Use the existing `splitMessage` helper from
  `src/modules/telegram/client.ts` rather than truncating mid-citation
  or introducing a second chunking helper.
- **No legacy or compatibility shim.** `/answer-log` and `/answer-show`
  ship as the only Telegram surfaces for reading the answer-history
  store. The reply formats are the only formats; no opt-in flag, no
  v2 path.
- **No fan-out from this task.** Web `AnswerHistoryPanel`, macOS
  `AnswerHistoryView`, and mobile `AnswerHistoryScreen` are explicitly
  out of scope. They ship later as honest single-task follow-ups when
  there is a real operator pull for them, mirroring the discipline
  the cited-answer seam itself followed.

## Done When

- Two new commands `/answer-log` and `/answer-show` are dispatched in
  `src/modules/telegram/status-poll.ts` alongside the existing
  `/answer`, `/recall`, `/knowledge`, `/memory`, `/history`, and
  `/tasks` handlers, gated by the existing chat allowlist, with thin
  handlers that call `ctx.client.answer.log({ limit })` and
  `ctx.client.answer.show(id)` and render the typed responses.
- The shared list-row plain-text renderer (newly extracted into
  `src/modules/answer/render.ts` if not already present) is reused
  by both the CLI (`kota answer log`) and the Telegram handler so the
  one-line projection format is identical across surfaces.
- New status-poll tests cover, at minimum:
  - `/answer-log` over a store with multiple records (mixed
    `ok: true` and `ok: false`) renders newest-first one-line rows
    with timestamp, ok/reason badge, citation count where applicable,
    and truncated query.
  - `/answer-log` over an empty store replies with a fixed-body
    "no past answers" message.
  - `/answer-log 3` honors the explicit limit.
  - `/answer-log abc` (non-numeric or invalid limit) emits a fixed
    usage hint rather than calling the namespace.
  - `/answer-show <id>` of an `ok: true` record renders the prose
    body followed by the typed citation block, byte-identical to the
    same record re-rendered by `/answer` would have produced.
  - `/answer-show <id>` of an `ok: false` record renders the typed
    failure reason without a synthesized body.
  - `/answer-show <id>` of an unknown id replies with a fixed-body
    "not found" message and does not throw.
  - `/answer-show` with no id argument emits a fixed usage hint.
- Telegram allowlist gating is exercised in tests: a non-allowlisted
  chat hitting either command receives no answer-history content.
- `src/modules/telegram/index.ts` updates the bot description string
  (`Responds to /status, /digest, ...`) to include the two new
  commands without otherwise changing the registration shape, and
  reflects in any setMyCommands path the bot already maintains.
- A captured Telegram transcript under the run directory shows
  (a) `/answer "<query>"` returning a normal cited answer,
  (b) `/answer-log` listing that answer alongside any other recorded
  answers,
  (c) `/answer-show <id>` re-rendering the body and citations
  identically to step (a),
  (d) `/answer-show <unknown-id>` returning the typed not-found
  reply.
  The transcript is captured against a real running bot (or a
  recorded `bot.test.ts`-style harness invocation) — not synthesized
  ASCII.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T00-47-10-852Z-explorer-dteyjk/` after the
answer-history store landed at commit `21bdc367` and the previous
fan-out chain (Telegram `/answer` → web `AnswerPanel` → macOS
`DaemonClient.answer` + `AnswerView` → mobile `AnswerScreen`) closed
the live-synthesis fan-out. Inspecting `src/modules/answer/cli.ts`
shows `kota answer log` and `kota answer show <id>` already render the
typed projection / record envelopes, and `src/modules/telegram/
status-poll.ts` shows `/answer` already consumes
`KotaClient.answer.answer`. The matching read commands do not yet
exist on the chat surface where most ad-hoc synthesized answers
actually originate — phone-first chat — so the personal-assistant
promise still breaks at re-reading. The previous task explicitly
named surface fan-out (Telegram, web, macOS, mobile) as separate
honest follow-ups; this is the first one.

## Initiative

Personal-assistant answering — durable. KOTA should let an operator
re-read yesterday's synthesized answer from the same surface where it
was originally asked, not only from a terminal. Telegram is the
single highest-leverage chat surface for that re-read because it is
where most ad-hoc `/answer` calls already happen. This task lands the
chat-side read commands. Web, macOS, and mobile adoption follow as
separate honest tasks when there is a real operator pull for them,
mirroring the discipline the cited-answer seam itself followed.

## Acceptance Evidence

- Diff covering the two new `/answer-log` and `/answer-show` Telegram
  handlers in `src/modules/telegram/status-poll.ts`, any shared
  list-row helper added to `src/modules/answer/render.ts`, and the
  bot description / command-registration update in
  `src/modules/telegram/index.ts`.
- Status-poll tests proving the multi-row listing, empty-store reply,
  explicit limit, invalid-limit usage hint, ok-arm `/answer-show`,
  ok=false-arm `/answer-show`, unknown-id not-found, missing-id
  usage hint, and chat-allowlist gating — running through `pnpm test`.
- A captured Telegram transcript under the run directory showing
  `/answer "<query>"` followed by `/answer-log`, then
  `/answer-show <id>` re-rendering byte-identically, then
  `/answer-show <unknown-id>` returning the not-found body.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` green.
