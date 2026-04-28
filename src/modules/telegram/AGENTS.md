# Telegram Module

This directory owns the Telegram integration — interactive bot access and
notification forwarding.

- Contributes two daemon channels: `telegram-status` (responds to
  `/status`, `/digest`, `/attention`, the per-store search commands
  `/knowledge`, `/memory`, `/history`, `/tasks`, the unified-recall
  `/recall`, the cited-answer `/answer` plus `/answer-log` /
  `/answer-show`, the cross-store capture `/capture` plus the four
  `/capture-to-{memory,knowledge,tasks,inbox}` twins, and the
  cross-store retract umbrella `/retract` plus the four
  `/retract-{memory,knowledge,tasks,inbox}` explicit-target commands)
  and `telegram-interactive` (hosts one agent session per chat). Both
  are started and stopped by the daemon alongside other channels.
- `/digest` and `/attention` call `renderOnDemandDigest` /
  `renderOnDemandAttention` directly. Both must not write cadence
  snapshots, must not advance counters, must not emit
  `workflow.daily.digest` / `workflow.attention.digest`, are not gated
  by quiet hours, and reply in-band. `/attention` falls back to the
  fixed `NO_ATTENTION_ITEMS_TEXT` body so "nothing wrong" is
  distinguishable from "command failed". Operator-facing only — never
  exposed to autonomy agents in any prompt path.
- All read, capture, and retract commands (`/knowledge`, `/memory`,
  `/history`, `/tasks`, `/recall`, `/answer`, `/answer-log`,
  `/answer-show`, `/capture`, `/capture-to-*`, `/retract`,
  `/retract-*`) are thin wrappers over their `KotaClient` namespace
  and render through the owning module's plain-text helper — no
  copy of CLI rendering on the Telegram side. Each is plain text
  (Markdown-active characters appear unescaped in titles, bodies,
  synthesized prose, identifiers, and contributor errors), gated by
  the chat allowlist only, advances no cadence counter, emits no
  workflow event, surfaces no cost or token signal, and is
  operator-facing only.
- The four per-store search commands call
  `ctx.client.<store>.search` with `{ semantic: true, limit: 10 }`.
  Empty / whitespace-only queries reply with a usage hint and skip
  the store call. Empty results reply with a fixed per-store body so
  "nothing matched" is distinguishable from "command failed".
  `{ ok: false, reason: "semantic_unavailable" }` surfaces a one-line
  explanation rather than silently degrading to keyword search.
- `/recall` is the unified-recall entry point — one ranked,
  source-tagged list spanning every registered store. The recall seam
  owns merge, normalize, and ranking; the Telegram handler does not
  fan out to per-store search seams. Empty hits → `"No matching
  items."`; no contributors → `"Cross-store recall is not configured:
  no contributors are registered."`.
- `/answer` is the cited-answer composition surface — one prose
  answer plus typed citations, not a second recall path. It consumes
  `ctx.client.answer.answer(query)` and renders `AnswerResult`
  exhaustively (success + three `ok: false` reasons, no `default`)
  through `renderAnswerCitationsPlain`. The seam owns retrieval
  delegation, synthesis, citation parsing, and the one-retry policy;
  the handler adds no second prompt, parser, retry, or budget.
- `/capture` plus `/capture-to-{memory,knowledge,tasks,inbox}` and the
  four `/retract-{memory,knowledge,tasks,inbox}` are the cross-store
  write-side and correction-side surfaces. Each family shares one
  handler that resolves the target from the command name (twins) or
  leaves it unset (capture umbrella only), then dispatches to
  `ctx.client.capture.capture` / `ctx.client.retract.retract`. The
  seam owns classification (capture only), contributor dispatch,
  ambiguous-degradation (capture) / `not_found` (retract), and
  contributor-failure isolation; the Telegram layer adds no second
  classifier, parallel routing, or per-store fan-out. The reply
  renders the discriminated `CaptureResult` / `RetractResult`
  exhaustively (every record arm + every `ok: false` reason, no
  `default` branch) through `renderCaptureReplyPlain` /
  `renderRetractResultPlain`. The retract tasks arm carries the
  seam's `previousPath -> path (dropped)` "moved to dropped"
  wording, never "deleted". The retract seam has no classifier —
  there is no unguided `/retract <text>` primary; the umbrella
  `/retract` exists only to print a fixed help body. Empty /
  whitespace-only argument short-circuits locally to the ambiguous
  envelope (capture) or a per-target usage body (retract); neither
  handler calls its seam with an empty body.
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

Owner-question escalations flow through `OwnerQuestionQueue` from
three answer surfaces (recorded source label only differs):
inline-keyboard buttons (`telegram-inline`) for `proposed_answers`
plus dismissal; chat reply with `reply_to_message_id` to the
delivered owner-question message (`telegram-reply`) for free-form
text; and the `kota owner-question` CLI (`http`/CLI). Free-form
replies coexist with proposed-answer buttons — the first resolution
wins; later replies to the now-stale message fall through to the
interactive agent session, preserving the "clarifying follow-up" use
case. Replies that do not match a tracked owner-question message
also fall through. The chat allowlist applies to chat replies just
like ordinary text messages.

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
