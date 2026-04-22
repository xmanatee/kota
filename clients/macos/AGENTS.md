# macOS Menu Bar Client

A native macOS menu bar client for the KOTA daemon.

- All state comes from the daemon API through the daemon client wrapper. Views
  should not scatter route strings, auth handling, or response decoding.
- Local and remote daemon discovery should share the same connection model.
  Secrets belong in Keychain, not view state or committed files.
- If the daemon is unreachable, clear live data and show an offline state
  instead of preserving stale runtime state.
- Do not add Swift Package dependencies without a strong reason. The app is intentionally minimal.
- Voice goes through the daemon's `/voice/transcribe` and `/voice/synthesize`
  routes. Microphone capture uses `AVAudioRecorder`; playback uses
  `AVAudioPlayer`. Surface the daemon's typed failure codes
  (`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`) one-to-one
  in the chat UI. Never import a TTS or STT vendor SDK in the app.
