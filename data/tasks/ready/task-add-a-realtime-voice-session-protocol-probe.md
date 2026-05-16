---
id: task-add-a-realtime-voice-session-protocol-probe
title: Add a realtime voice-session protocol probe
status: ready
priority: p2
area: modules
summary: Define and test a strict voice-session event/state protocol so future realtime voice, WebRTC, or telephony channels can share KOTA's daemon/channel/session boundary instead of inventing per-client audio loops.
created_at: 2026-05-16T04:40:46.000Z
updated_at: 2026-05-16T04:40:46.000Z
---

## Problem

KOTA's voice module is correctly transport-neutral today, but its executable
surface is request/response STT and TTS: clients post a whole audio blob for
transcription or a whole text body for synthesis. That is enough for voice
notes and push-to-talk UI, but it does not prove the daemon/channel boundary can
host a realtime voice session where audio arrives in chunks, transcripts are
partial before final, assistant audio may stream back, and the user can
interrupt a turn.

The current LiveKit Agents signal is not "add LiveKit" or "build another
client." The useful architecture lesson is that realtime voice systems need an
explicit session lifecycle and turn protocol before transports, telephony
connectors, or UI fan-out are added. Without that protocol, a future WebRTC,
phone, Slack huddle, or native voice channel will be tempted to own its own
audio loop and drift away from KOTA's daemon-owned sessions.

## Desired Outcome

The voice module owns a small, strict realtime voice-session protocol and a
headless probe proving the lifecycle works without adding an external realtime
provider. A future channel should be able to route microphone frames and
assistant audio through one typed event/state machine while continuing to use
the existing daemon session and provider boundaries.

## Constraints

- Do not add a LiveKit dependency, WebRTC server, phone connector, or new UI
  surface in this task. This is the protocol/state-machine slice only.
- Keep the existing `/voice/transcribe`, `/voice/synthesize`,
  `/api/voice/transcribe`, `/api/voice/synthesize`, and `client.voice.*`
  request/response contracts stable.
- Reuse the existing `voice` and `transcription` module boundaries. Realtime
  voice must not call STT, TTS, model, or vendor APIs directly from a client or
  channel.
- Use strict discriminated unions and loud transition errors. Do not introduce
  nullable state, permissive fallbacks, or "best effort" coercion for malformed
  internal events.
- Treat user speech transcripts as user input, matching the existing
  injection-defense parity note in `src/modules/voice/AGENTS.md`.
- Keep the first probe headless and deterministic; rendered client evidence
  belongs to later channel/client tasks.

## Done When

- `src/modules/voice/` exposes a typed realtime voice-session event protocol
  covering at least: session start, input audio chunk, partial transcript,
  final transcript, assistant text, assistant audio chunk, interruption/cancel,
  terminal completion, and terminal error.
- A voice-session state machine validates legal event order and rejects
  malformed sequences loudly, including audio after completion, final transcript
  before session start, duplicate terminal events, and interruption of an
  already-closed turn.
- A headless probe or unit test simulates one successful realtime turn and one
  interrupted turn without a network provider. It proves the protocol can bind
  to an existing KOTA session id/channel identity and emit a reconstructible
  timeline.
- Provider-unavailable and chunk-budget failures produce typed terminal error
  events that preserve the voice module's existing failure vocabulary where it
  overlaps (`stt-unavailable`, `tts-unavailable`, `stt-failed`, `tts-failed`).
- `src/modules/voice/AGENTS.md` is updated narrowly to say future realtime
  voice transports must use this protocol/state machine rather than inventing
  a per-surface audio lifecycle.

## Source / Intent

Explorer run `2026-05-16T04-37-41-172Z-explorer-x6pn6x` reviewed the empty
queue. All strategic blocked alternatives exposed by `inspect-queue` are
operator-capture gated and not movable. Several recent watchlist signals have
already been converted into done tasks today:

- Codex reconnectable remote-control shape ->
  `task-add-reconnectable-daemon-client-timeline-probe`.
- Goose protocol-message-over-heuristics signal ->
  `task-centralize-tool-observation-summarization-around-t`.
- Gemini CLI native headless/OAuth shape ->
  `task-add-native-gemini-cli-harness-managed-preset`.
- Google Research pricing follow-up ->
  `task-add-shipped-preset-pricing-coverage-for-codex-a`.

The remaining nonduplicative strategic signal is LiveKit Agents'
production-oriented realtime voice agent direction: session lifecycle,
streaming media, interruption, and telephony-style concerns. KOTA already has
a good request/response voice module and daemon channel protocol; the missing
slice is a strict voice-session lifecycle that future realtime channels can
share.

Sources checked:

- `https://github.com/livekit/agents`
- `https://docs.livekit.io/agents/`
- `https://github.com/livekit/agents/releases`

## Initiative

Realtime voice boundary: KOTA should support future voice channels through the
same daemon/session/module model as text channels, with one protocol-owned
audio turn lifecycle before any transport-specific implementation.

## Acceptance Evidence

- Test transcript for the focused protocol/state-machine coverage, for example
  `pnpm test src/modules/voice/realtime-session.test.ts`.
- If daemon event emission or channel binding is touched, include the matching
  focused test transcript for the affected daemon/channel module.
- Diff review shows no new realtime vendor dependency, no new UI/client
  surface, and no change to existing request/response voice route shapes.
