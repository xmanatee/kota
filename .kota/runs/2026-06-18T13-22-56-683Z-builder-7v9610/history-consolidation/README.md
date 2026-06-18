# History Consolidation Evidence

Task: `task-fan-out-consolidation-history`

This directory replaces the unsupported older artifact path previously named
by the task. It contains current evidence for the history surface family.

## Generated Contract Evidence

- `probe-contract.mjs` -> `contract-probe.json`
  - Exercises `src/modules/history/routes.ts` directly.
  - Covers semantic unavailable, populated semantic success, empty semantic
    success, filter forwarding, keyword fallback, and provider-thrown failure.
- `capture-cli-transcript.sh` -> `cli-transcript.txt`
  - Exercises `kota history` help, list, search, JSON output, missing show,
    semantic-unavailable copy, empty keyword results, and limit validation.

## Rendered Surface Fixtures

- `surfaces/mobile/history-screen-rendered.json`
  - React Native rendered-tree fixture for `HistoryScreen` states.
- `surfaces/macos/history-view-rendered-states.txt`
  - Manifest for SwiftUI-rendered PNG snapshots of mounted
    `HistoryBodyView` states. Image files live under
    `surfaces/macos/history-view-rendered-states/`.
- `surfaces/telegram/messages.md`
  - Rendered Telegram `/history` reply fixture for usage, populated,
    empty-results, and semantic-unavailable states.

## Verification

- `KOTA_RUN_DIR=.kota/runs/2026-06-18T13-22-56-683Z-builder-7v9610 pnpm --dir clients/mobile test -- --runInBand HistoryScreen.test.tsx`
- `KOTA_RUN_DIR=.kota/runs/2026-06-18T13-22-56-683Z-builder-7v9610 swift test --disable-sandbox --filter HistoryViewTests`
