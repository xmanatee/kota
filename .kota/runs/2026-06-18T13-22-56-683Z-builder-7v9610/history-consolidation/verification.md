# History Consolidation Verification

The older headless-review directory named in the task body is not present in
this checkout, so this run regenerated the missing daemon/CLI evidence under
this run directory.

- `contract-probe.json` verifies the shared history search route envelopes:
  semantic unavailable, supported semantic success, empty success,
  filter forwarding, keyword fallback, and provider throw.
- `cli-transcript.txt` verifies top-level/history discoverability, list/search/show
  help, empty-query validation, semantic unavailable text and JSON,
  keyword no-match text and JSON, missing conversation lookup, and invalid
  limit validation through the source CLI entrypoint.
- `surfaces/mobile/history-screen-rendered.json` verifies the mobile
  `HistoryScreen` operator states as a React Native rendered-tree fixture.
- `surfaces/macos/history-view-rendered-states.txt` verifies the macOS
  `HistoryView` operator states by indexing SwiftUI-rendered PNG snapshots
  produced from mounted `HistoryBodyView` instances.
- `surfaces/telegram/messages.md` verifies the Telegram `/history` rendered
  reply shapes.

The existing task body already names the follow-up tasks and records the docs
reality check. No client code was changed for this review task.
