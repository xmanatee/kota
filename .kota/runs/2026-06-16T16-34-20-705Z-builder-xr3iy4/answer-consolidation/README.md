# Answer Consolidation Evidence

Task: `task-fan-out-consolidation-answer`

This directory replaces the unsupported older artifact path previously named by
the task. It contains current headless evidence for the answer surface family.

## Generated Contract Evidence

- `probe-contract.mjs` -> `contract-probe.json`
  - Exercises `src/modules/answer/routes.ts` directly.
  - Covers `POST /answer` empty-query 400, success 200, `no_hits` 200,
    `semantic_unavailable` 200, `synthesis_failed` 200, and provider-throws 500.
  - Covers `GET /answers` mixed entries, `GET /answers/:id` found, and
    `GET /answers/:id` not-found.
- `probe-cli.mjs` -> `cli-transcript.txt`
  - Exercises the registered `kota answer` command renderer with a stubbed
    answer client.
  - Covers help, success, no-hits, empty-query usage, log text, log JSON,
    show found, show not-found text, and show not-found JSON.

## Rendered Surface Fixtures

- `surfaces/web/answer-family.html`
  - Headless HTML report for `AnswerPanel`, `AnswerResultView`, and
    `AnswerHistoryPanel` states.
- `surfaces/mobile/answer-family.rendered.json`
  - React Native rendered-tree fixture for `AnswerScreen`,
    `AnswerBody`, and `AnswerHistoryScreen` states.
- `surfaces/macos/answer-family.snapshot.txt`
  - SwiftUI state snapshot for `AskUnifiedView` answer mode and
    `AnswerHistoryView`.
- `surfaces/telegram/messages.md`
  - Telegram rendered-message transcript for `/answer`, `/answer-log`, and
    `/answer-show`, including usage and not-found cases.
- `surfaces/slack/messages.md`
  - Slack rendered-message transcript for `/answer`, `/answer-log`, and
    `/answer-show`, including usage and not-found cases.

## Verification

`pnpm exec vitest run src/modules/answer/routes.test.ts src/modules/answer/cli.test.ts`
passed with 29 tests on 2026-06-16.
