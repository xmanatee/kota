---
id: task-wire-voice-for-web-macos-mobile-clients
title: Wire voice input and output in macOS and mobile clients
status: done
priority: p2
area: clients
summary: Voice already ships in the CLI and the web client through `/api/voice/*`. The native macOS menu-bar app and the mobile client still need voice UI and platform audio plumbing on top of the same routes.
created_at: 2026-04-22T21:27:58Z
updated_at: 2026-04-22T22:19:45.784Z
---

## Problem

The voice module exposes two surfaces — `POST /voice/transcribe` and
`POST /voice/synthesize` on the daemon control API, and the mirror
`POST /api/voice/transcribe` / `POST /api/voice/synthesize` on `kota serve`.
The CLI consumes the daemon control API round-trip and the web client
(`clients/web`) consumes `/api/voice/*` through `MediaRecorder` capture
and `HTMLAudioElement` playback. The native macOS menu-bar app and the
iOS/Android companion still have no voice UI or audio plumbing.

Without this task, voice on those surfaces remains gated by hand-running
the CLI even though the daemon-side surface is transport-neutral and
already proven against two clients.

## Desired Outcome

The macOS and mobile clients capture microphone input, post it to the
voice endpoints, and play synthesized audio back through the platform's
native audio pipeline. Credentials, provider selection, and format
negotiation stay in the daemon — the clients only own recording and
playback. Failure modes surface the daemon's `stt-unavailable`,
`tts-unavailable`, and `tts-format-unsupported` codes as user-visible UI
states, matching the shape the CLI and web client already use.

## Constraints

- No per-client vendor calls. All audio bytes flow through the daemon's
  voice routes. A client that imports a TTS SDK directly is a regression.
- Respect the 16 MB daemon voice body budget. Long-form recordings must
  be segmented or bounced through an upload endpoint before reaching the
  voice routes.
- Use the existing control-API auth path (bearer token for
  daemon-control, whatever `kota serve` already uses for `/api/*`). No
  new credential surfaces.
- Mirror the voice module's failure codes and messages one-to-one in
  every client so the operator learns one vocabulary — the web client's
  banner shape is the reference.

## Done When

- The native macOS app has a microphone-capture affordance and a
  spoken-output control, both backed by the daemon's voice routes. A
  failing provider surfaces the server-reported `code` in the UI.
- The mobile companion (iOS or Android — pick the shipping surface) has
  a voice entry point through the same routes with the same failure
  surfacing.
- At least one integration or e2e test per client covers a successful
  round-trip and at least one explicit failure mode.
- No client imports a TTS or STT SDK directly; the voice module remains
  the only place providers are resolved.
