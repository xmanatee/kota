# Mobile Client

React Native mobile client for the KOTA daemon.

- All state comes from the daemon control API — no `.kota/` file parsing.
- Authentication secrets belong in the OS secure store.
- Navigation should stay thin: screens call the daemon client/context and avoid
  embedding daemon protocol details.
- Live updates should use the daemon's live-update path, with centralized
  polling only where the platform requires it.
- Setup flows may read operator-provided daemon connection details, but parsing
  and persistence belong in shared mobile helpers.

## Push Notification Deep Links

Push notification routing is owned by the daemon payload contract and the mobile
navigation helpers. Keep new destinations covered by reducer/navigation tests
instead of maintaining a prose table of payload constants.

## Adding Features

- Do not add server-side endpoints. The existing daemon API is sufficient.
- If a missing API capability is discovered, file a task to `tasks/inbox/` rather than patching the daemon.
- Keep screens thin: fetch from `DaemonContext` or call `daemonClient` directly; no business logic in screens.

## Voice

Voice goes through the daemon's `/voice/transcribe` and `/voice/synthesize`
routes via `daemonClient.voiceTranscribe` / `voiceSynthesize`. Microphone
capture and playback live in `src/voice/voiceRecorder.ts` (a thin wrapper
around `expo-av`). Surface the daemon's typed failure codes
(`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`) one-to-one
in the chat UI. Never import a TTS or STT vendor SDK directly.
