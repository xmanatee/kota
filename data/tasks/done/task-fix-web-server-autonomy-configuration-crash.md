---
id: task-fix-web-server-autonomy-configuration-crash
title: Fix web server autonomy configuration crash
status: done
priority: p1
area: core
summary: Ensure the web server (kota serve) can start without a fatal autonomy posture error when unconfigured, while still maintaining Kota's security mandate of defined permissions for interactive agents.
created_at: 2026-04-28T14:25:00.000Z
updated_at: 2026-04-29T00:06:57.758Z
---

## Problem

When running `node dist/cli.js serve`, the server crashes with a fatal error: `web server: autonomy mode is not configured`. This happens because `src/modules/web/web-operations.ts` calls `resolveChannelAutonomyMode(undefined, ctx.config, "web server")`.

The `resolveChannelAutonomyMode` helper is strictly designed to throw if no posture is found in either the channel-specific config or the global `config.serve.defaultAutonomyMode`. While this protectiveness is correct for autonomous agents, it creates a "cold start" failure for the web server, which might be used solely for monitoring or local read-only interaction where a global posture hasn't been established yet.

## Desired Outcome

The web server should be able to boot even if no global autonomy posture is configured. It should either:
- Provide a safe, passive default for the web server if unconfigured.
- Or, defer the hard check until an actual interactive agent session is initiated through the web API.

The goal is to allow `kota serve` to work out-of-the-box for its monitoring/UI functions without requiring the user to immediately edit `kota-config.json`.

## Constraints

- Do not bypass the autonomy check for actual agent runs; every agent session MUST have a defined posture.
- Maintain consistency with how the CLI and other channels (Telegram, Slack) resolve their postures.
- The fix should be architectural (how and when we resolve) rather than just a hardcoded fallback in the web module.

## Done When

- `node dist/cli.js serve` starts successfully without any `ANTHROPIC_API_KEY` or `defaultAutonomyMode` configured.
- The web UI is reachable and functional for monitoring/status.
- Attempting to start an agent session through the web API without a configured posture still results in a clear error or falls back to a safe, documented default (like `passive`).

## Source / Intent

Investigation on 2026-04-28 found that the web server was uniquely sensitive to the lack of a global `serve.defaultAutonomyMode` because it resolved its posture eagerly during the boot sequence. This creates a friction point for new users and was identified as an architectural inconsistency compared to the CLI's more resilient startup.

## Initiative

Resilient Boot: ensure KOTA surfaces are available for inspection even when agent-specific configuration is incomplete.

## Acceptance Evidence

- Transcript of `node dist/cli.js serve` starting and listening without a `serve` config block.
- Verification that the web server still correctly handles autonomy when a session is actually created.
