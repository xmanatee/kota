---
id: task-run-kota-as-a-telegram-personal-assistant-on-a-ser
title: Run KOTA as a Telegram personal assistant on a server
status: backlog
priority: p2
area: channels
summary: Confirm and close gaps so KOTA can run end-to-end as a personal assistant channeled through Telegram, including a voice-message transcription pipeline.
created_at: 2026-04-22T03:21:32.088Z
updated_at: 2026-04-22T03:21:32.088Z
---

## Problem

KOTA already ships a daemon (`src/modules/daemon-ops`), a Telegram channel
(`src/modules/telegram`), the scheduler, and first-class skills/sessions —
the building blocks for an OpenClaw-style personal assistant. What is missing
is a confirmed end-to-end path: a server-hosted KOTA daemon that owns a
Telegram-channeled personal assistant session with skills, scheduled jobs,
and at least one inbound media pipeline (e.g. transcribing voice messages
received over Telegram before they reach the agent).

## Desired Outcome

An operator can configure KOTA on a server with Telegram bot credentials and
get a working personal-assistant deployment: incoming Telegram messages
(text and voice) reach a session backed by skills and the scheduler, voice
notes are transcribed before the agent sees them, and scheduled jobs run on
the daemon clock without an interactive operator attached.

## Constraints

- Use the existing `channel`, `session`, `workflow`, and `module` protocols.
  Do not introduce a parallel personal-assistant runtime.
- Keep the voice-transcription pipeline behind an explicit module/tool
  boundary; the channel must not call a transcription API directly.
- No hidden defaults for credentials; configuration must go through the
  normal config/secrets surface.
- Guardrails (autonomy mode, injection-defense, approval queue) must remain
  in effect for messages arriving from Telegram.

## Done When

- A documented setup path lets an operator stand up KOTA on a server with
  Telegram as the primary channel, end to end (config, skills enabled,
  scheduler running).
- Inbound Telegram voice messages are transcribed by a module-owned pipeline
  before the agent step sees them, with a clear failure mode when the
  transcription provider is unavailable.
- An integration test or live-run artifact demonstrates a Telegram message
  reaching the session loop and a scheduled workflow firing on the same
  daemon process.
- Any gaps surfaced by this work are split into focused follow-up tasks
  rather than absorbed into this one.
