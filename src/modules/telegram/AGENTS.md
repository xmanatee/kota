# Telegram Module

This directory owns the Telegram integration — interactive bot access and
notification forwarding.

- Contributes two daemon channels: `telegram-status` (responds to `/status`
  with workflow state, to `/digest` with the on-demand daily digest, to
  `/attention` with the on-demand attention digest, to `/knowledge <query>`
  with a semantic-ranked knowledge search, to `/memory <query>` with a
  semantic-ranked memory search, to `/history <query>` with a
  semantic-ranked conversation search, to `/tasks <query>` with a
  semantic-ranked repo-task-queue search, and to `/recall <query>` with
  one ranked, source-tagged list across every registered store) and
  `telegram-interactive` (hosts one agent session per chat). Both are
  started and stopped by the daemon alongside other channels.
- The `/digest` command calls the daily-digest module's
  `renderOnDemandDigest` seam directly. It must not write the cadence
  snapshot file and must not emit `workflow.daily.digest` (otherwise other
  notification channels would receive a duplicate, surprising digest).
  Quiet hours intentionally do not gate `/digest` — the call is operator
  initiated and replies in-band to the requesting chat. Like the cadence
  digest, the rendered body is operator-facing only and must not be
  exposed to autonomy agents in any prompt path.
- The `/attention` command mirrors `/digest` for the symmetric attention
  surface: it calls the attention-digest module's `renderOnDemandAttention`
  seam directly, must not advance the cadence counter
  (`.kota/attention-digest-counter.json`), must not emit
  `workflow.attention.digest`, is not gated by quiet hours, and posts the
  rendered text in-band. When nothing warrants attention the bot replies
  with the short fixed `NO_ATTENTION_ITEMS_TEXT` body so the operator can
  distinguish "nothing wrong" from "command failed". The body is
  operator-facing only and must not be exposed to autonomy agents.
- The `/knowledge <query>`, `/memory <query>`, `/history <query>`, and
  `/tasks <query>` commands expose the same semantic-search seams the
  CLI and the matching `/api/*` route serve. Each calls
  `ctx.client.<store>.search` with `{ semantic: true, limit: 10 }` and
  renders results via the store's shared plain-text helper (no copy of
  CLI rendering on the Telegram side). Empty / whitespace-only queries
  reply with a usage hint and skip the store call. Empty results reply
  with a fixed per-store body (`"No matching knowledge entries."`,
  `"No matching memory entries."`, `"No matching conversations."`,
  `"No matching tasks."`) so the operator can distinguish "nothing
  matched" from "command failed". When no embedding-backed provider is
  configured the search returns
  `{ ok: false, reason: "semantic_unavailable" }` and the bot surfaces
  a one-line explanation instead of silently degrading to keyword
  search. Replies are plain text (titles and bodies can carry
  Markdown-active characters), are not gated by quiet hours, never
  advance any cadence counter or emit a workflow event, and are
  operator-facing only — they must not be exposed to autonomy agents
  in any prompt path.
- The `/recall <query>` command is the unified-recall entry point: it
  is a thin wrapper over `ctx.client.recall.recall(query)` and renders
  one ranked, source-tagged list spanning every registered store via
  `renderRecallHitsPlain` from the recall module. `/recall` does not
  fan out to per-store search seams — the recall seam already owns
  merge, normalize, and ranking. Empty / whitespace-only queries reply
  with a usage hint; an empty hit list replies with `"No matching
  items."`; an `{ ok: false, reason: "semantic_unavailable" }` result
  (no contributors registered) replies with `"Cross-store recall is
  not configured: no contributors are registered."`. Like the
  per-store commands, `/recall` is plain text, gated by the chat
  allowlist only (no quiet-hours gating), advances no cadence counter,
  emits no workflow event, and is operator-facing only.
- Contributes notification subscriptions for workflow events.
- Optional event filters must not suppress urgent owner/approval escalation
  notifications.
- Interactive sessions use configured autonomy explicitly. Missing
  session-autonomy config is a startup error, not a hidden fallback.
- Inbound voice and audio messages route through the `transcription` module
  before reaching the session loop. The bot never calls a transcription
  vendor API directly; absence of a registered provider surfaces to the
  user as an explicit failure, not a silent drop.
- The interactive channel does not own the scheduler. The daemon owns it; the
  channel subscribes to `schedule.fire` bus events and broadcasts reminders
  to active chat sessions.

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
without one. Set it through the `modules.telegram.defaultAutonomyMode`
config key (or the shared `serve.defaultAutonomyMode` config). Restrict
who can open interactive sessions via
`modules.telegram.allowedChatIds`; empty or unset allows any chat.

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
text messages — disallowed chats cannot resolve owner questions.

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
