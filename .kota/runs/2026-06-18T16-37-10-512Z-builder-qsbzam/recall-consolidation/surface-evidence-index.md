# Recall Consolidation Surface Evidence

Current run verification replaces the older May artifact path that was not present in this worktree.

## Current contract and test artifacts

- `contract-probe.json` — route-level probe for `createRecallRouteHandler`, decoded through `clients/conformance/decoders.ts` `parseRecallResult`.
- `recall-module-tests.txt` — focused recall module tests: 3 files, 20 tests.
- `web-recall-tests.txt` — web contract fixture and RecallPanel tests: 19 files, 177 tests.
- `surface-runtime-evidence/web/recall-panel-mounted-dom-manifest.json` — mounted DOM evidence generated from the web `RecallPanel` for operator-visible empty, ranked-hit, no-hit, and unavailable states.
- `telegram-recall-tests.txt` — focused Telegram `/recall` runtime-evidence test: 1 file, 1 test.
- `surface-runtime-evidence/telegram/recall-command-runtime.json` — runtime evidence generated from `handleTelegramStatusCommand`, covering the Telegram `/recall` request and reply path for mixed-source success, answer-hit failure, `semantic_unavailable`, and empty-result arms.
- `mobile-recall-tests.txt` — mobile contract fixture and RecallScreen evidence: 2 suites, 82 tests, 1 snapshot.
- `apple-recall-tests.txt` — Apple ContractFixtureTests and RecallViewTests: 76 XCTest cases across the two filters.

## Rendered surface evidence committed with this change

- `.kota/runs/recall-consolidation-screens-20260615T160041Z/telegram/chat-rendered-replies.txt`
- `.kota/runs/2026-06-18T16-37-10-512Z-builder-qsbzam/recall-consolidation/surface-runtime-evidence/telegram/recall-command-runtime.md`
- `.kota/runs/recall-consolidation-screens-20260615T160041Z/slack/chat-rendered-replies.txt`
- `.kota/runs/recall-consolidation-screens-20260615T160041Z/mobile/mobile-screen-tests.txt`
- `.kota/runs/recall-consolidation-screens-20260615T160041Z/macos/rendered-menu-bar-states.txt`
- `.kota/runs/recall-consolidation-screens-20260615T160041Z/web/web-component-tests.txt`
- `.kota/runs/recall-consolidation-screens-20260615T160041Z/web/recall-panel-mounted-dom-manifest.json`
- `.kota/runs/2026-06-18T16-37-10-512Z-builder-qsbzam/recall-consolidation/surface-runtime-evidence/web/recall-panel-mounted-dom-manifest.json`
