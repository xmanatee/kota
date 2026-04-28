# Telegram Module

This directory owns the Telegram integration — interactive bot access and
notification forwarding.

- Contributes two daemon channels: `telegram-status` (responds to
  `/status`, `/digest`, `/attention`, the per-store search commands
  `/knowledge`, `/memory`, `/history`, `/tasks`, the unified-recall
  `/recall`, the cited-answer `/answer` plus `/answer-log` /
  `/answer-show`, and the cross-store capture `/capture` plus the four
  `/capture-to-{memory,knowledge,tasks,inbox}` twins) and
  `telegram-interactive` (hosts one agent session per chat). Both are
  started and stopped by the daemon alongside other channels.
- The `/digest` command calls the daily-digest module's
  `renderOnDemandDigest` seam directly. It must not write the cadence
  snapshot file and must not emit `workflow.daily.digest`. Quiet hours
  do not gate `/digest` — the call is operator initiated and replies
  in-band. The rendered body is operator-facing only and must not be
  exposed to autonomy agents in any prompt path.
- The `/attention` command mirrors `/digest` for the symmetric attention
  surface: it calls `renderOnDemandAttention` directly, must not advance
  the cadence counter (`.kota/attention-digest-counter.json`), must not
  emit `workflow.attention.digest`, is not gated by quiet hours, and
  posts in-band. When nothing warrants attention the bot replies with
  the fixed `NO_ATTENTION_ITEMS_TEXT` body so the operator can
  distinguish "nothing wrong" from "command failed". Operator-facing
  only.
- All read and capture commands (`/knowledge`, `/memory`, `/history`,
  `/tasks`, `/recall`, `/answer`, `/answer-log`, `/answer-show`,
  `/capture`, `/capture-to-*`) are thin wrappers over their
  `KotaClient` namespace and render through the owning module's
  plain-text helper — no copy of CLI rendering on the Telegram side.
  Each is plain text (titles, bodies, synthesized prose, captured
  identifiers, and contributor error messages can carry Markdown-active
  characters), gated by the chat allowlist only, advances no cadence
  counter, emits no workflow event, surfaces no cost or token signal,
  and is operator-facing only.
- The four per-store search commands call
  `ctx.client.<store>.search` with `{ semantic: true, limit: 10 }`.
  Empty / whitespace-only queries reply with a usage hint and skip
  the store call. Empty results reply with a fixed per-store body so
  the operator can distinguish "nothing matched" from "command
  failed". `{ ok: false, reason: "semantic_unavailable" }` surfaces a
  one-line explanation rather than silently degrading to keyword
  search.
- `/recall` is the unified-recall entry point — one ranked,
  source-tagged list spanning every registered store. The recall seam
  owns merge, normalize, and ranking; the Telegram handler does not
  fan out to per-store search seams. Empty hits → `"No matching
  items."`; no contributors → `"Cross-store recall is not configured:
  no contributors are registered."`.
- `/answer` is the cited-answer composition surface — one prose
  answer plus typed citations, not a second recall path. It consumes
  `ctx.client.answer.answer(query)` and renders the discriminated
  `AnswerResult` exhaustively (success + the three `ok: false`
  reasons, no `default` branch) reusing `renderAnswerCitationsPlain`.
  The seam owns retrieval delegation, synthesis, citation parsing,
  and the one-retry policy; the handler adds no second prompt,
  parser, retry, or budget.
- `/capture` and the four `/capture-to-<target>` twins are the
  cross-store capture surface — the symmetric write-side counterpart
  to `/recall` and `/answer`. All five share one handler that
  resolves an explicit `target` from the command name (twins) or
  leaves it unset (unguided), then dispatches to
  `ctx.client.capture.capture`. The seam owns classification,
  contributor dispatch, ambiguous-degradation, and contributor-failure
  isolation; the Telegram layer adds no second classifier path,
  parallel routing, or per-store fan-out. The reply renders the
  discriminated `CaptureResult` exhaustively (four `CaptureRecord`
  arms + three `ok: false` reasons, no `default` branch) through
  `renderCaptureReplyPlain` from the capture module. Empty /
  whitespace-only `<text>` short-circuits to the ambiguous envelope
  locally — the handler refuses to call the seam with an empty body.
- Contributes notification subscriptions for workflow events.
  Optional event filters must not suppress urgent owner/approval
  escalation notifications.
- Interactive sessions use configured autonomy explicitly. Missing
  session-autonomy config is a startup error, not a hidden fallback.
- Inbound voice/audio messages route through the `transcription` module
  before reaching the session loop. The bot never calls a transcription
  vendor API directly; absence of a registered provider surfaces as an
  explicit failure, not a silent drop.
- The interactive channel does not own the scheduler. The daemon owns
  it; the channel subscribes to `schedule.fire` bus events and
  broadcasts reminders to active chat sessions.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
- Does not own transcription. Voice input is delegated to the
  `transcription` module's `TranscriptionProvider` boundary.

## Operator Deployment

Run KOTA as a Telegram-channeled personal assistant by running the daemon
alongside a transcription provider. One process owns the daemon, both
Telegram channels, the scheduler, and all workflows — there is no second
process to supervise.

Required environment:

- `ANTHROPIC_API_KEY` — model backend for the interactive session loop.
- `TELEGRAM_BOT_TOKEN` — BotFather-issued token for the bot account.
- `TELEGRAM_ALERT_CHAT_ID` — chat id that receives notification events
  and is allowed to issue `/status`.

Autonomy mode is mandatory — the interactive channel refuses to start
without one. Set it through `modules.telegram.defaultAutonomyMode` (or
the shared `serve.defaultAutonomyMode`). Restrict interactive sessions
via `modules.telegram.allowedChatIds`; empty or unset allows any chat.

Owner-question escalations support three answer surfaces, all of which
flow through the same `OwnerQuestionQueue` API and differ only in the
recorded source label:

- inline-keyboard buttons (`telegram-inline`) for the listed
  `proposed_answers` plus dismissal,
- chat reply with `reply_to_message_id` pointing at the delivered
  owner-question message (`telegram-reply`) for free-form text, and
- the `kota owner-question` CLI on a workstation (`http`/CLI).

Free-form replies coexist with proposed-answer buttons — the first
resolution wins and the binding is released, so a later reply to the
now-stale message falls through to the interactive agent session
instead of attempting to re-answer. Replies that do not match a tracked
owner-question message also fall through, preserving the
"clarifying follow-up" use case for the interactive session. The chat
allowlist applies to chat replies the same way it applies to ordinary
text messages.

Voice input requires a transcription provider. Install a module that
registers one under service type `"transcription"`; missing providers
produce a user-visible failure message rather than a silent drop.

Start the server-side stack by running `kota daemon` with the telegram
module loaded. The daemon brings up the `telegram-status` and
`telegram-interactive` channels automatically when the required env vars
are present.

A reproducible deploy artifact for a production Linux host lives in
`deploy/telegram-assistant/`. It packages both a docker-compose path
and a system-level systemd unit behind one `install.sh` and a matching
`rollback.sh`. Keep `deploy-artifact.test.ts` aligned with that
directory when required env vars, supervisor directives, or the
install-script contract change.
