---
id: task-add-a-voice-module-with-stt-and-tts-usable-across-
title: Add a voice module with STT and TTS usable across all client surfaces
status: backlog
priority: p2
area: modules
summary: Introduce a voice capability shared by the CLI client and every other client (web, macOS, mobile, Telegram), with pluggable STT (cloud + local Whisper) and TTS providers behind a single module boundary.
created_at: 2026-04-22T16:47:02.731Z
updated_at: 2026-04-22T16:47:02.731Z
---

## Problem

KOTA has a `transcription` module with a Whisper provider, used today by the
Telegram channel to transcribe voice notes. There is no corresponding output
path (TTS) and no shared voice capability that operator-facing clients — CLI,
web, native macOS, mobile — can consume. The CLI is effectively a client of
the daemon; it should be able to accept voice input and speak responses the
same way any other client does. Right now each client would have to invent its
own audio pipeline to get voice, which would duplicate provider selection,
credential handling, and streaming behavior.

## Desired Outcome

One voice module owns the end-to-end capability: STT input from any client,
TTS output to any client, with pluggable providers on both sides. The CLI
becomes a real client of the daemon that can take typed or spoken input and
speak responses back through a theme-consistent UX. Web, macOS, and mobile
clients reach the same voice surface through the daemon control API — no
duplicated audio stacks per client.

## Constraints

- Build on the existing `transcription` protocol for STT rather than creating
  a parallel abstraction. Extend or rename it only if extending clashes with
  the TTS side of the contract.
- Ship at least one server-side and one local STT provider (reusing
  `transcription-whisper` for cloud; an optional local Whisper backend for
  offline use) and at least one server-side TTS provider, all behind the
  module's typed protocols.
- Credentials live behind the existing config/secrets surface; no committed
  keys, no hidden vendor defaults. Optional local providers must not be a
  required dependency.
- Keep the voice module transport-neutral. Clients talk to the daemon's
  control API; they do not reach providers directly. No per-client audio
  pipeline.
- The CLI must become a genuine client of the daemon for voice; do not add a
  second in-process audio path only for CLI mode.
- Failure modes (missing provider, credential failure, network failure) must
  surface cleanly to the user at every client, the same way
  `transcription-unavailable` already does in Telegram.
- Voice content entering agent context goes through `injection-defense` on
  the same footing as other external text input.

## Done When

- A voice module ships under `src/modules/` with STT and TTS protocols, a
  registered server-side STT and TTS provider, and an opt-in local STT
  backend.
- The daemon control API exposes voice input and output for clients, with
  tests covering a successful round-trip and at least one explicit failure
  mode per direction.
- The CLI client supports voice input and spoken output through the new
  module, demonstrated by an integration test or recorded `.kota/runs/`
  artifact.
- Web, macOS, and mobile clients pick up voice through the same control-API
  path — at minimum one non-CLI client ships in this task and the others have
  a follow-up task.
- The module's `AGENTS.md` documents the protocols, provider opt-in, and
  failure modes at the conventions level, without duplicating provider
  catalogs in docs.
