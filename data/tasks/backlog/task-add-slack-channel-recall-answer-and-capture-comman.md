---
id: task-add-slack-channel-recall-answer-and-capture-comman
title: Add Slack-channel /recall, /answer, and /capture commands consuming the cross-store seams
status: backlog
priority: p1
area: modules
summary: Extend src/modules/slack-channel/bot.ts with first-class slash commands /recall, /answer, and /capture that route through the same cross-store seams Telegram already consumes, achieving second-channel parity for the unified knowledge fan-out and giving Slack-resident operators the same recall/answer/capture surface as Telegram users.
created_at: 2026-04-28T05:27:28.853Z
updated_at: 2026-04-28T05:27:28.853Z
---

## Problem

The cross-store recall, cited-answer, and capture seams are now
deliberately uniform across operator surfaces:

- CLI: `kota recall`, `kota answer`, `kota capture`.
- Daemon control + user-facing HTTP routes:
  `POST /recall`, `POST /api/recall`,
  `POST /answer`, `POST /api/answer`,
  `POST /capture`, `POST /api/capture`.
- Telegram channel: `/recall <query>`, `/answer <question>`,
  `/answer-log`, `/answer-show`, `/capture <text>`, plus the four
  `/capture-to-{memory,knowledge,tasks,inbox}` twins.
- Web client: `RecallPanel`, `AnswerPanel`, `AnswerHistoryPanel`,
  `CapturePanel`.
- macOS menu bar: `RecallView`, `AnswerView`, `DaemonClient.capture`
  (CaptureView is the parallel sibling task).
- Mobile: `RecallScreen`, `AnswerScreen` (CaptureScreen is the
  parallel sibling task).

The Slack channel module (`src/modules/slack-channel/`) is the only
registered messaging-channel surface that has none of these
commands. Today the bot routes every DM straight to a per-user
`AgentSession` with no command parsing — Slack-resident operators
have no way to do the same one-shot recall / answer / capture they
get on Telegram. This is a visible product gap the moment a real
operator is on Slack instead of Telegram, and it leaves the cross-
store seams under-leveraged on a channel KOTA already supports.

The recall/answer/capture seams were built specifically so any
channel can call them through `ctx.client.{recall,answer,capture}`
without reimplementing the contract. Slack is the smallest, highest-
ROI place to prove the second-channel parity, because the seams
already exist, the rendering helpers (`renderRecallHitsPlain`,
`renderAnswerResultPlain`, `renderCaptureReplyPlain`) already exist,
and the only missing piece is command parsing on the Slack bot
message handler.

## Desired Outcome

The Slack channel module gains first-class slash commands that
route through the cross-store seams without spawning a session for
the request:

- `/recall <query>` — calls `ctx.client.recall.recall(query, {})`
  and replies with the rendered plain-text hits, mirroring the
  Telegram `/recall` reply body byte-for-byte.
- `/answer <question>` — calls `ctx.client.answer.answer(question)`
  and replies with the rendered cited-answer body, mirroring the
  Telegram `/answer` reply body byte-for-byte. Failure arms
  (`no_hits`, `semantic_unavailable`, `synthesis_failed`) surface
  one-to-one with their fixed strings.
- `/capture <text>` — calls
  `ctx.client.capture.capture(text, undefined)` and replies with
  the rendered capture body, mirroring the Telegram `/capture`
  reply via `renderCaptureReplyPlain`. Ambiguity surfaces the
  Slack equivalent of the `/capture-to-*` hints (e.g. "Re-run
  with `/capture-to-<target>`"). The four `/capture-to-{memory,
  knowledge,tasks,inbox}` twins also work, pinning the target
  verbatim.

A free-form (non-slash) DM still routes to the per-user session
exactly as it does today; the slash commands are an additive entry
point alongside the existing message handler, not a replacement.
The session-based path keeps owning multi-turn agent conversations.

The four operator-visible branches surface one-to-one with the seam
contract on each command, with no silent coercion: an empty query
or text shows a usage hint and skips the call; a daemon-side error
surfaces the typed message; the `ambiguous` / `no_contributors` /
`contributor_failed` capture arms render their fixed bodies; the
recall `semantic_unavailable` arm and the answer `no_hits` /
`semantic_unavailable` / `synthesis_failed` arms render their
fixed bodies.

## Constraints

- All command parsing and dispatch live in
  `src/modules/slack-channel/bot.ts`. Do not add a parallel
  command registry; do not pull in a third-party slash-command
  library; do not reach for `commands/` module abstractions
  (those target CLI, not Slack).
- The Slack `/recall`, `/answer`, `/capture`, and four
  `/capture-to-*` commands must call the same
  `ctx.client.{recall,answer,capture}` surfaces the Telegram bot
  consumes. Do not reach into the per-store providers, do not
  re-issue the daemon HTTP route, and do not introduce a Slack-
  specific recall/answer/capture wire shape.
- Reuse the existing rendering helpers verbatim
  (`renderRecallHitsPlain`, `renderAnswerResultPlain`,
  `renderCaptureReplyPlain`). Do not add a third format. Where
  the chat-surface variant
  (`renderCaptureReplyPlain`) is the right body — i.e. the
  Slack reply, like the Telegram reply, is a chat message — use
  it; do not switch to the CLI/web body.
- Slash-command messages must NOT be forwarded to the per-user
  `AgentSession`. They are one-shot. Free-form (non-slash) DMs
  must continue to route to the session exactly as they do
  today.
- Surface the daemon's typed errors one-to-one (HTTP error path
  matches the existing Telegram bot pattern); do not swallow,
  retry, or coerce.
- The bot's existing approval-button path stays unchanged; no
  refactor of the approval Block Kit or session pool in this
  task.
- Keep `src/modules/slack-channel/bot.ts` close to the AGENTS.md
  size norm (current ~282 lines). If the new command-dispatch
  block pushes the file over ~350 lines, factor a tightly-scoped
  `commands.ts` sibling rather than splintering across many
  files; do not pre-emptively re-architect the bot for command
  registration before there is a third command source.
- Do not introduce a Slack-specific config for command names. The
  command names are fixed strings.
- Mirror the Telegram bot's command-parsing tolerance: leading
  whitespace OK; case-insensitive command match; bot mention
  prefix (e.g. `@kota /recall foo`) is stripped before dispatch.

## Done When

- `src/modules/slack-channel/bot.ts` (or a tightly-scoped
  `commands.ts` sibling, if size demands) parses `/recall`,
  `/answer`, `/capture`, `/capture-to-memory`,
  `/capture-to-knowledge`, `/capture-to-tasks`,
  `/capture-to-inbox` from incoming Slack DMs and dispatches each
  through `ctx.client.{recall,answer,capture}`, replying with the
  shared plain-text rendering helpers.
- Free-form (non-slash) DMs continue to route to the per-user
  `AgentSession` unchanged.
- `src/modules/slack-channel/bot.test.ts` covers, per command,
  the success arm and at least one structured failure arm
  (recall: `semantic_unavailable`; answer: `no_hits` and
  `synthesis_failed`; capture: `ambiguous`, `no_contributors`,
  `contributor_failed`), plus the empty-input usage hint, plus
  one regression test asserting that a non-slash DM still creates
  / reuses a session.
- `pnpm --filter kota test` passes; the Slack channel test suite
  is green; no recall / answer / capture / Telegram fan-out
  tests regress.
- The Slack-channel `AGENTS.md` is updated to name the new
  slash-command surface alongside the existing approval and
  session-routing contracts.

## Source / Intent

The empty `ready/` queue at trigger `autonomy.queue.empty` follows
the just-shipped macOS `DaemonClient.capture` (commit `33595c0a`),
which is the second-to-last fan-out step for the cross-store
capture seam (mobile `CaptureScreen` and macOS `CaptureView` are
the remaining per-client surface tasks). With the cross-store
recall, cited-answer, answer-history, and capture seams all on
their final per-client tasks, the next strategic gap is the
second messaging channel. Slack channel today has zero recall /
answer / capture commands; bringing it to Telegram parity is the
highest-leverage non-mechanical extension of the cross-store fan-
out, because every consumer surface is already typed and
rendered. The data-model trail is recorded in commits `09d60ce3`
(recall seam), `082c565f` (answer seam), `21bdc367` (answer-
history store), and `805a6edf` (capture seam); the Telegram
adoption commits are `6510f998`, `82a544af`, `daa25e07`, and
`d4c35d1e`.

## Initiative

Second-channel parity for the cross-store seams — extend the
Telegram-style recall / answer / capture surface to a second
messaging channel so KOTA's "ask anything across knowledge,
memory, history, and tasks" promise is reachable from Slack as
well as Telegram, and so the cross-store seams stop being a
single-channel feature in practice.

## Acceptance Evidence

- `pnpm --filter kota test` output covering the new
  Slack-channel command tests.
- A captured Slack DM transcript (or local socket-mode fixture
  transcript) showing each of `/recall`, `/answer`, `/capture`,
  and one `/capture-to-*` returning a real reply against the
  configured stores, plus one `/capture` ambiguous case
  surfacing the suggestion list with the `/capture-to-*` hint,
  plus one free-form (non-slash) DM round-trip proving the
  session path still works.
- A short rendered-output sample (line shape) from the Slack
  reply for one recall / answer / capture command next to the
  equivalent Telegram reply, proving body parity.
