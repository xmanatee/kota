# Telegram Module

This directory owns the Telegram integration — interactive bot access and
notification forwarding.

- Contributes two daemon channels: `telegram-status` for readiness/status
  command declaration and `telegram-interactive` for chat sessions. The
  interactive channel owns the single Bot API `getUpdates` stream; never add
  a second daemon long-poll loop for the same token.
- `/digest` and `/attention` call `renderOnDemandDigest` /
  `renderOnDemandAttention` directly. Both must not write cadence
  snapshots, must not advance counters, must not emit
  `workflow.daily.digest` / `workflow.attention.digest`, are not gated
  by quiet hours, and reply in-band. `/attention` falls back to the
  fixed `NO_ATTENTION_ITEMS_TEXT` body so "nothing wrong" is
  distinguishable from "command failed". Operator-facing only — never
  exposed to autonomy agents in any prompt path.
- Read, capture, and retract commands are thin wrappers over their
  `KotaClient` namespace and render through the owning module's
  plain-text helper — no copy of CLI rendering on the Telegram side.
  They are allowlist-gated, do not advance cadence counters or emit
  workflow events, and are operator-facing only.
- On multi-project daemons, Telegram resolves one project per chat
  before running commands or interactive sessions. Defaults live in
  `modules.telegram.chatProjectBindings`; `/project` lists hosted
  projects and updates the daemon-owned per-chat selection. Unbound
  chats fail with an explicit reply instead of falling back to the
  active/default project. Single-project daemons do not show project
  labels and do not need `/project`.
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
  write-side and correction-side surfaces. Each family shares one handler
  that resolves the target, dispatches to the capture/retract client seam,
  and renders `CaptureResult` / `RetractResult` exhaustively through the
  plain-text helpers. Telegram adds no second classifier, parallel routing,
  or per-store fan-out. The retract tasks arm keeps the seam's
  `previousPath -> path (dropped)` "moved to dropped" wording; the umbrella
  `/retract` only prints help. Empty bodies short-circuit locally and never
  call the seam.
- Contributes notification subscriptions for workflow events.
  Optional event filters must not suppress urgent owner/approval
  escalation notifications.
- Interactive sessions use configured autonomy explicitly. Missing
  session-autonomy config is a startup error, not a hidden fallback.
- Inbound voice/audio messages route through the `transcription` module
  before reaching the session loop. The bot never calls a transcription
  vendor API directly; absence of a registered provider surfaces as an
  explicit failure, not a silent drop.
- Prefix-configured text updates emit `inbound.signal.received` with project
  scope, Telegram source metadata, and chat trust. The shared inbound-signals
  dispatcher decides source eligibility and workflow routing; Telegram does not
  decide whether a signal becomes a task, answer, owner question, or no-op.
- The interactive channel does not own the scheduler. The daemon owns
  it; the channel subscribes to `schedule.fire` bus events and
  broadcasts reminders to active chat sessions.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
- Does not own transcription. Voice input is delegated to the
  `transcription` module's `TranscriptionProvider` boundary.
- Does not add provider-local automation planning for chat messages; configured
  updates enter the shared inbound-signals dispatcher.

## Operator Deployment

Run KOTA as a Telegram-channeled personal assistant by running the daemon
alongside a transcription provider. One process owns the daemon, both
Telegram channels, the scheduler, and all workflows — there is no second
process to supervise.

Required environment:

- `TELEGRAM_BOT_TOKEN` — BotFather-issued token for the bot account.
- `TELEGRAM_ALERT_CHAT_ID` — chat id that receives notification events
  and is allowed to issue `/status`.

Model backend selection is KOTA config, not Telegram-specific. For Docker
deploys, `deploy/telegram-assistant/entrypoint.sh` can derive it from
`KOTA_MODEL` plus the selected provider's key, or an explicit provider/preset.
Anthropic keys are optional and only needed for Anthropic-backed selections.

Autonomy mode is mandatory — the interactive channel refuses to start without
one. Set it through `modules.telegram.defaultAutonomyMode` (or the shared
`serve.defaultAutonomyMode`). Restrict interactive sessions via
`modules.telegram.allowedChatIds`; empty or unset allows any chat.

Owner-question escalations flow through `OwnerQuestionQueue` from inline
buttons (`telegram-inline`), chat replies to the delivered question
(`telegram-reply`), and the `kota owner-question` CLI (`http`/CLI). The first
resolution wins; stale or unrelated replies fall through to the interactive
session. The chat allowlist applies to replies like ordinary messages.

Voice input requires a transcription provider. Install a module that
registers one under service type `"transcription"`; missing providers
produce a user-visible failure message rather than a silent drop.

Start the server-side stack by running `kota daemon` with the telegram
module loaded. The daemon brings up the `telegram-status` declaration and
the `telegram-interactive` poller automatically when the required env vars
are present. `telegram-status` must not call `getUpdates`; Telegram cancels
older long polls when more than one consumer uses the same bot token.

A reproducible Linux deploy artifact lives in `deploy/telegram-assistant/`.
It packages docker-compose and systemd paths behind `install.sh` and
`rollback.sh`; keep `deploy-artifact.test.ts` aligned with that contract.
