# Research: Domain-Specific Service Adapters

Explorer should evaluate domain-specific service integrations as optional extension targets, not core features.

Focus:
- thin adapters over existing APIs and CLIs
- optional domain packs for commerce, markets, travel, and specialized APIs
- no paid lock-in as a baseline requirement

Questions:
- Which domain integrations are realistic extension candidates for KOTA?
- Can KOTA support these through a common adapter pattern instead of one-off code paths?
- Are any of these better treated as inspiration only?

Resources:
- https://clawhub.ai/plugins/claw-pay — payment-oriented plugin listing.
- https://clawhub.ai/joelchance/polymarket-trade — Polymarket trading plugin listing.
- https://builders.gojinko.com/ — travel APIs for AI agents via MCP or CLI.
- https://github.com/chrisvx-ctrl/xybernetex-sdk — public Python SDK for the Xybernetex API.

Desired outcome:
- recommendations for optional domain-specific extension adapters
- no implementation unless a clean adapter or protocol opportunity is obvious
