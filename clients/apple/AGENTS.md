# Apple Clients (macOS + iOS)

Native KOTA clients for macOS and iOS. The package is one Swift
package contributing three targets so daemon transport, view-models,
and SwiftUI views are written once for both platforms:

- `KotaShared`  : library — daemon client, contract decoders,
  `AppState` view-model, platform protocols, and the SwiftUI views
  shared by both shells.
- `KotaMenuBar` : macOS executable — `MenuBarExtra` shell, AppKit-
  backed `MacOSPlatform`, and macOS notification surface.
- `KotaiOS`     : iOS executable — `WindowGroup` + `TabView` shell,
  UIKit-backed `iOSPlatform`, and iOS notification surface.

## Conventions

- All state comes from the daemon API through the daemon client
  wrapper. Views should not scatter route strings, auth handling, or
  response decoding.
- Local and remote daemon discovery share the same connection model.
  Secrets belong in Keychain, not view state or committed files.
- If the daemon is unreachable, clear live data and show an offline
  state instead of preserving stale runtime state.
- Do not add Swift Package dependencies without a strong reason. The
  apps are intentionally minimal.
- Voice goes through the daemon's `/voice/transcribe` and
  `/voice/synthesize` routes. Microphone capture uses
  `AVAudioRecorder`; playback uses `AVAudioPlayer`. Surface the
  daemon's typed failure codes (`stt-unavailable`, `tts-unavailable`,
  `tts-format-unsupported`) one-to-one in the chat UI. Never import a
  TTS or STT vendor SDK in the app.

## Platform Shell Boundary

The shared module never imports `AppKit` or `UIKit`. Platform-
specific affordances (NSOpenPanel, NSWorkspace, UIApplication,
notification authorization, terminate) are routed through the
`PlatformAffordances` protocol declared in
`Sources/KotaShared/PlatformAffordances.swift` and the
`NotificationManaging` protocol declared in
`Sources/KotaShared/NotificationSurface.swift`. Each shell wires its
own concrete implementation:

- macOS — `MacOSPlatform` + `MacOSNotificationManager` (in
  `Sources/KotaMenuBar/`).
- iOS — `iOSPlatform` + `iOSNotificationManager` (in
  `Sources/KotaiOS/`).

Each shell file is wrapped in `#if os(macOS)` / `#if os(iOS)` so the
opposite platform's executable target still compiles cleanly when
`xcodebuild` against the package builds every scheme. The wrapped-out
target falls back to a `_Stub` `@main` that aborts with a clear
message if invoked on the wrong platform.

## Daemon Contract Layout

Daemon contract Codable mirrors and per-route wire-shaping live under
`Sources/KotaShared/Daemon/`, split per capability namespace
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

## Build & Test

- macOS app bundle: `./build-macos.sh` (was `build-app.sh`) — wraps
  `swift build -c release` into a runnable `KotaMenuBar.app` with
  `LSUIElement=true`.
- iOS Simulator app: `./build-ios.sh` — wraps `xcodebuild` against
  the iPhone 17 Pro simulator destination.
- Cross-platform tests: `swift test` (macOS host) runs the full
  `KotaSharedTests` + `KotaMenuBarTests` suites. To run the same
  shared suite on iOS, use
  `xcodebuild test -scheme KotaApple-Package -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`
  — this exercises the same view-model and decoder code on the iOS
  runtime.

## Tests

`KotaSharedTests` covers the shared decoders, view-model, and
deterministic SwiftUI snapshot fixtures (e.g. trigger-sheet rendered
output, recall empty-state snapshot, diagnostic header per state).
`KotaMenuBarTests` keeps the macOS-specific menu-bar IA snapshot;
the test imports `KotaShared` because it operates on shared types and
does not call into the macOS shell.
