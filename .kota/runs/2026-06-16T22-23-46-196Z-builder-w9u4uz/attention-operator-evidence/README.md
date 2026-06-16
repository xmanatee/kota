# Attention Operator Evidence

Generated for `task-fan-out-consolidation-attention` during the 2026-06-16 builder repair.

This directory fills the two evidence gaps from the critic review:

- `runtime-contract-probe.json` exercises the quiet and populated request arms through the daemon attention route handler, `node bin/kota.mjs attention --json`, Telegram `/attention`, Slack `/attention`, the web TypeScript decoder, the mobile production decoder copy, and the macOS Swift `AttentionResponse` decoder compiled from `clients/apple/Sources/KotaShared/Daemon/AttentionModels.swift`.
- `web/attention-panel-rendered-report.html` plus `web/*.html`,
  `mobile/*.json`, `macos/attention-view-rendered-states.txt`,
  `telegram/attention-messages.json`, and `slack/attention-messages.json`
  are the rendered per-surface fixtures for operator-visible attention states.
  Playwright screenshot capture is unavailable in this sandbox, so the web
  surface uses the accepted HTML-report artifact.

The probe fails if any surface returns a different `items` list or `text` body for the same quiet/populated route bodies.
