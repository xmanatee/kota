---
id: task-host-telegram-interactive-bot-inside-the-daemon
title: Host Telegram interactive bot inside the daemon
status: backlog
priority: p2
area: channels
summary: Move the kota telegram interactive bot off its standalone CLI process into a daemon-contributed channel so one daemon owns both scheduler and Telegram conversation lifecycle.
created_at: 2026-04-22T04:52:38.995Z
updated_at: 2026-04-22T04:52:38.995Z
---

## Problem

`src/modules/telegram/bot.ts` runs the interactive Telegram bot as a
standalone CLI process (`kota telegram`) with its own singleton
scheduler call. The daemon already hosts the `telegram-status` channel
and owns the scheduler — but the interactive bot lives outside that
lifecycle. Operators have to run two processes side-by-side and keep
them in sync.

## Desired Outcome

The interactive Telegram bot becomes a daemon-contributed channel
following the `ChannelDef` protocol. When `kota serve` is running, the
interactive Telegram session is hosted by the daemon alongside
workflows, the scheduler, and the status channel. No second process is
required on a server deployment.

## Constraints

- Use the existing `ChannelDef` protocol — do not add a second channel
  contribution surface.
- Session autonomy mode config resolution must stay explicit; a missing
  mode is still a startup error, not a fallback.
- Inbound Telegram content must continue to route through the
  `transcription` module and the normal guardrails (autonomy mode,
  injection-defense, approval queue).
- Credentials continue to come through the standard secrets surface;
  no hidden defaults.

## Done When

- The interactive Telegram bot lifecycle is owned by the daemon via a
  contributed `ChannelDef`, not by a separate CLI process.
- `kota serve` on a server with the required env vars brings up both
  the status and interactive Telegram channels without a second
  process.
- Existing `kota telegram` CLI either delegates to the daemon or is
  retired, with callers updated in the same change (no parallel
  surface).
- Voice handling continues to route through `src/modules/transcription`
  with the same clear failure mode.
- Integration test exercises an inbound Telegram message reaching
  `AgentSession.send` inside the daemon process.

