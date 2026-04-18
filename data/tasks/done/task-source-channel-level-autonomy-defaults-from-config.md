---
id: task-source-channel-level-autonomy-defaults-from-config
title: Source channel-level autonomy defaults from config instead of hardcoding
status: done
priority: p2
area: architecture
summary: Slack, Telegram, Vercel adapter and other non-web channels hardcode a fixed autonomy mode; every channel should read its default from config with the daemon-level default as fallback, so operators control supervision posture per channel instead of editing source
created_at: 2026-04-18T06:12:35.832Z
updated_at: 2026-04-18T14:20:00.000Z
---

## Problem

Session autonomy mode is a first-class runtime control, but channel and CLI
entrypoints were still choosing fixed modes in source instead of resolving
operator configuration consistently.

Operators who want to run, for example, a supervised posture on Telegram but
an autonomous posture inside the KOTA CLI session must fork source. The
session-autonomy axis is declared everywhere but operator-configurable only in
one place, which undermines the very point of making it an operator control.

## Desired Outcome

- Every channel/entrypoint that opens a session resolves its autonomy mode
  through the config subsystem, with a loud error when no valid mode is
  configured for that boundary.
- The generated config schema includes the relevant session-autonomy knobs.
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
- Do not change the session autonomy vocabulary. The change is about where the
  value is sourced, not what it means.
- Do not weaken workflow agent-step autonomy declarations — those must stay
  explicit per the recent required-field change.
- Follow KOTA's boundary rule: shared config resolution belongs with core
  config/session wiring, not in a random module.

## Done When

- Slack, Telegram, Vercel adapter, web server, and CLI entrypoints all resolve
  session autonomy from configuration without hardcoded defaults.
- The generated config schema describes the relevant fields.
- Channel tests cover both override-present and override-absent resolution.
- Local guidance describes the convention without duplicating schema details.
