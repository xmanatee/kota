---
id: task-source-channel-level-autonomy-defaults-from-config
title: Source channel-level autonomy defaults from config instead of hardcoding
status: ready
priority: p2
area: architecture
summary: Slack, Telegram, Vercel adapter and other non-web channels hardcode a fixed autonomy mode; every channel should read its default from config with the daemon-level default as fallback, so operators control supervision posture per channel instead of editing source
created_at: 2026-04-18T06:12:35.832Z
updated_at: 2026-04-18T06:12:35.832Z
---

## Problem

Session autonomy mode is a first-class runtime control and there is already a
daemon-level `config.serve.defaultAutonomyMode` knob. Only the web server
actually reads it (`src/modules/web/index.ts` falls back to `"supervised"`).
Every other channel entrypoint hardcodes a constant instead:

- `src/modules/slack-channel/bot.ts` → `autonomyMode: "supervised"`.
- `src/modules/telegram/bot.ts` → `autonomyMode: "supervised"`.
- `src/modules/vercel-adapter/index.ts` → `autonomyMode: "supervised"`.
- `src/modules/history/cli-commands.ts` and `cli.ts` → `autonomyMode:
  "autonomous"`.

Operators who want to run, for example, a supervised posture on Telegram but
an autonomous posture inside the KOTA CLI session must fork source. The
session-autonomy axis is declared everywhere but operator-configurable only in
one place, which undermines the very point of making it an operator control.

## Desired Outcome

- Every channel/entrypoint that opens a session resolves its autonomy mode
  through the config subsystem: explicit per-channel default first, daemon
  `config.serve.defaultAutonomyMode` as the fallback, with a loud error (not a
  silent default) if neither is set.
- The config schema documents per-channel `defaultAutonomyMode` on the
  channels operators can actually configure (Slack, Telegram, web, Vercel
  adapter, CLI).
- No module hardcodes a literal autonomy mode in session construction except
  internal workflow agent steps (where the mode is declared at the workflow
  definition level and must stay explicit).
- Tests exercise each channel entrypoint with and without a per-channel
  override to confirm the resolution order.

## Constraints

- Keep the strict-by-default discipline: no `?? "supervised"` fallbacks
  scattered across modules. Resolve through one shared helper.
- Per-channel defaults belong on each channel's own config shape, not in a
  second global registry. Daemon-ops and channel config live where they
  already do.
- Do not change the session API surface or the `AutonomyMode` union. The
  change is about where the value is sourced, not what it means.
- Do not weaken workflow agent-step autonomy declarations — those must stay
  explicit per the recent required-field change.
- Follow KOTA's boundary rule: the shared resolver belongs in `src/core/` (or
  a config helper alongside the existing session-pool wiring), not in a
  random module.

## Done When

- Slack, Telegram, Vercel adapter, web server, and the CLI history/replay
  entrypoints all resolve autonomy mode through the shared helper.
- `schema/kota-config.schema.json` describes per-channel `defaultAutonomyMode`
  fields where applicable.
- A grep for literal `autonomyMode: "supervised"` / `"autonomous"` /
  `"passive"` in channel and CLI entrypoints returns zero matches (workflow
  agent-step declarations are exempt).
- Channel tests cover both override-present and override-absent resolution.
- Config docs (local `AGENTS.md` on the relevant modules) describe the
  resolution order at a conventions level.
