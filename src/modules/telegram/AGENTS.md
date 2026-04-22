# Telegram Module

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- Optional event filters must not suppress urgent owner/approval escalation
  notifications.
- Interactive sessions use configured autonomy explicitly. Missing
  session-autonomy config is a startup error, not a hidden fallback.
- Inbound voice and audio messages route through the `transcription` module
  before reaching the session loop. The bot never calls a transcription
  vendor API directly; absence of a registered provider surfaces to the
  user as an explicit failure, not a silent drop.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
- Does not own transcription. Voice input is delegated to the
  `transcription` module's `TranscriptionProvider` boundary.

## Operator Deployment

Run KOTA as a Telegram-channeled personal assistant by combining the
daemon, the `kota telegram` interactive bot, and a transcription
provider. All three run in the same process on the server.

Required environment:

- `ANTHROPIC_API_KEY` — model backend for the interactive session loop.
- `TELEGRAM_BOT_TOKEN` — BotFather-issued token for the bot account.
- `TELEGRAM_ALERT_CHAT_ID` — chat id that receives notification events
  and is allowed to issue `/status`.

Autonomy mode is mandatory — the channel refuses to start without one.
Set it through the `modules.telegram.defaultAutonomyMode` config key (or
the shared session-autonomy config). The interactive bot applies the
configured mode to every chat session so guardrails (autonomy mode,
injection-defense, approval queue) remain in effect for every inbound
Telegram message.

Scheduled reminders and notifications share the daemon's scheduler —
there is no second scheduler to configure. Any skill or module loaded
for the daemon is available to the interactive Telegram session
automatically.

Voice input requires a transcription provider. Install a module that
registers one under service type `"transcription"`; missing providers
produce a user-visible failure message rather than a silent drop.

Start the server-side stack by running `kota serve` (daemon, scheduler,
notification channels) and `kota telegram` (interactive bot) in the same
process supervisor. Both share the daemon's singleton scheduler.
