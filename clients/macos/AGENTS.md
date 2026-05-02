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

## Daemon Contract Layout

Daemon contract Codable mirrors and per-route wire-shaping live under
`Sources/KotaMenuBar/Daemon/`, split per capability namespace
(`<Namespace>Models.swift` for types/parsers/render helpers and
`<Namespace>Routes.swift` for the `extension DaemonClient` that adds
its routes). The namespace set is: Approvals, OwnerQuestions, Tasks,
Sessions, Digest, Attention, Knowledge, Memory, History, RepoTasks,
Recall, Answer, Capture, Retract, Voice, Chat, Core.

- `DaemonClient.swift` keeps the connection state, error envelope,
  request helpers (`get`/`post`/`patch`/`delete`/`throwIfHTTPError`/
  `decode`), and the small set of cross-cutting routes (`/identity`,
  `/capabilities`, `/workflow/*`, `/commands`).
- Per-namespace `*Routes.swift` files extend `DaemonClient` with the
  routes for that namespace and reuse the internal helpers.
- Per-namespace `*Models.swift` files own the Codable types, render
  helpers, and per-arm enums for that namespace.
- `ContractTypes.swift` keeps the cross-client thin-client contract
  decoders (identity, capabilities, workflow definitions); add a new
  contract surface there alongside the TypeScript and conformance
  fixture changes.
