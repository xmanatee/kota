# Attention Consolidation Verification

Task: `task-fan-out-consolidation-attention`

The task's historical headless-review path
`.kota/runs/2026-05-02T22-48-37-067Z-builder-4jyxov/attention-consolidation/`
is not present in this checkout. This run regenerated the current CLI evidence
and added current rendered/operator evidence under
`.kota/runs/2026-06-16T22-23-46-196Z-builder-w9u4uz/attention-operator-evidence/`.

## Evidence Checked

- `attention-operator-evidence/runtime-contract-probe.json` covers the same
  quiet and populated request arms through the daemon route handler, CLI JSON,
  Telegram `/attention`, Slack `/attention`, web decoder, mobile production
  decoder copy, and macOS Swift `AttentionResponse` decoder.
- `attention-operator-evidence/telegram/attention-messages.json` and
  `attention-operator-evidence/slack/attention-messages.json` include both
  quiet and populated rendered chat replies.
- `attention-operator-evidence/web/attention-panel-rendered-report.html`
  plus `web/*.html` cover loading, populated, quiet, and error/retry states
  from actual `AttentionPanel.test.tsx` DOM output. Playwright screenshot
  capture is sandbox-blocked, recorded in
  `web/attention-panel-rendered-report-screenshot-unavailable.txt`; the HTML
  report is the accepted web artifact.
- `attention-operator-evidence/mobile/*.json` covers not-configured,
  populated, quiet, error/retry, offline, and loading React Native rendered
  trees from `AttentionScreen.test.tsx`.
- `attention-operator-evidence/macos/attention-view-rendered-states.txt`
  covers collapsed quiet/populated badges, expanded quiet/populated body text,
  loading, and error/retry states. The same probe compiles
  `clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift` with
  `swiftc` and decodes the quiet/populated route bodies.
- `attention-cli-transcript.txt` from this run proves top-level CLI
  discoverability, `kota attention --help`, rendered text output, and the JSON
  envelope shape `{ items, text }`.

## Verdict

1. Information architecture: pass. The CLI command list includes `attention`;
   macOS places attention in the Browse group and attention inbox in Respond;
   mobile/web evidence covers their attention screens/panels; Telegram and
   Slack expose `/attention`.
2. Cross-client capability contract: pass. The current seam exposes the same
   `{ data: { items }, text }` route contract. The runtime contract probe
   shows each shipped surface matching the same quiet and populated request
   arms; CLI projects that envelope to `{ items, text }` for terminal use.
3. Duplication review: pass. No new fold-up follow-up is warranted by this
   verification; strict conformance decoder coverage already includes the
   attention response.
4. Provider readiness/unavailable state: pass. Attention has no upstream
   semantic provider arm; scoped guidance explicitly rejects a phantom
   `semantic_unavailable` arm.
5. Rendered evidence: pass. This run now includes per-surface artifacts for
   Telegram, Slack, mobile, macOS, web, CLI, and daemon/runtime contract
   behavior under `attention-operator-evidence/` plus
   `attention-cli-transcript.txt`.
6. Stale legacy affordances: pass. The rendered macOS IA snapshot records the
   old-to-new IA migration map; no stale attention-specific affordance was
   found.
7. Docs/AGENTS reality check: pass. `clients/AGENTS.md` and
   `src/modules/autonomy/workflows/attention-digest/AGENTS.md` describe the
   shared daemon/client and attention on-demand contracts.
8. Accepted critic warning review: pass. The task record says no follow-up was
   warranted after the batch warning review, and this verification found no
   current contradiction.

## Validation

- `pnpm test src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts src/modules/autonomy/workflows/attention-digest/attention-route.test.ts src/modules/autonomy/workflows/attention-digest/step.test.ts src/modules/telegram/status-poll.test.ts src/modules/slack-channel/bot.test.ts clients/conformance/decoders.test-cases.ts src/contract-fixture-cross-client.integration.test.ts`
  passed: 6 files, 194 tests.
- `node --conditions=source --import tsx .kota/runs/2026-06-16T22-23-46-196Z-builder-w9u4uz/attention-operator-evidence/probe/attention-runtime-contract-probe.mjs`
  passed and wrote the runtime contract, chat, daemon, CLI, and macOS decoder
  artifacts.
- `pnpm --dir clients/web test -- src/components/sidebar/AttentionPanel.test.tsx`
  passed: 19 files, 174 tests, and emitted the web rendered HTML fixtures.
- `pnpm --dir clients/web typecheck` passed.
- `pnpm --dir clients/web lint` passed.
- `pnpm --dir clients/mobile test -- AttentionScreen.test.tsx --runInBand`
  passed: 1 file, 9 tests, and emitted the mobile rendered tree fixtures.
- `pnpm --dir clients/mobile typecheck` passed.
- `node .kota/runs/2026-06-16T22-23-46-196Z-builder-w9u4uz/attention-operator-evidence/probe/build-web-attention-report.mjs`
  passed and wrote the web HTML report. Browser screenshot capture is blocked
  in this sandbox by Chromium Mach-port permissions, so no PNG was produced.
- SwiftPM package tests could not be rerun in this sandbox because SwiftPM
  invokes `sandbox-exec`, which is denied here. The runtime probe still
  compiles the production `AttentionModels.swift` decoder directly with
  `swiftc` and validates both request arms.
