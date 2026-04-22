---
id: task-ship-whisper-transcription-provider-module
title: Ship Whisper transcription provider module
status: backlog
priority: p2
area: modules
summary: Ship an OpenAI Whisper TranscriptionProvider module so Telegram voice messages transcribe against a real production backend.
created_at: 2026-04-22T04:52:43.271Z
updated_at: 2026-04-22T04:52:43.271Z
---

## Problem

`src/modules/transcription/` defines the `TranscriptionProvider`
protocol and registry boundary, but does not ship a default provider.
Operators who want voice input over Telegram need a production-grade
audio-to-text backend they can opt into through normal config.

## Desired Outcome

A new module registers a real transcription provider backed by OpenAI
Whisper (or an OpenAI-compatible endpoint via the existing
`model-clients` config). Operators enable it by listing the module and
providing credentials through the normal config/secrets surface; voice
messages then flow through Telegram → transcription → agent with no
other wiring required.

## Constraints

- Live behind the `TranscriptionProvider` protocol — do not bypass it
  to talk to Telegram or channels directly.
- Credentials via standard config/secrets; no hidden defaults and no
  committed keys.
- Retries and timeouts belong in the module, not in the channel.
- The Telegram `transcription-unavailable` failure mode must still
  surface to the user if this module is not enabled.

## Done When

- A module ships under `src/modules/` that registers a
  `TranscriptionProvider` for real production use.
- The provider is covered by focused tests, including a failure mode
  when credentials are missing or upstream returns an error.
- Telegram voice messages end-to-end transcribe when the module is
  loaded and credentials are present.
- Documentation (the module's `AGENTS.md`) explains opt-in, config
  keys, and failure modes without duplicating nearby docs.

