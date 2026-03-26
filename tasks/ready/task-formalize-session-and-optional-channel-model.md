---
id: task-formalize-session-and-optional-channel-model
title: Formalize sessions as core and channels as optional extensions
status: ready
priority: p1
area: session
summary: KOTA already has CLI, server, Telegram, and autonomous execution paths, but the concepts are not explicit. Make `session` a first-class core runtime concept and treat `channel` as an optional interaction extension for CLI, web, Telegram, and future surfaces.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA clearly has sessions today, but the concept is spread across loop, server,
Telegram, and workflow execution paths. It also has interactive surfaces that
behave like channels, but those are currently just modules or commands rather
than an explicit model.

This makes operator-facing integration harder to reason about and leaves the
boundary between autonomous runs and interactive surfaces blurry.

## Desired Outcome

- `session` is a documented first-class runtime concept with clear ownership and
  lifecycle.
- `channel` is an optional extension concept for external interaction surfaces.
- CLI, web, and Telegram align around the same session and channel model.
- Autonomous workflow execution reuses sessions without pretending every run is
  a channel interaction.

## Constraints

- Do not force a channel abstraction into paths that do not need it.
- Keep the model smaller than OpenClaw's gateway-first architecture.
- Preserve simple local CLI usage as the baseline path.

## Done When

- Session and channel boundaries are documented and reflected in code structure.
- Channel implementations use one shared model instead of ad hoc module-specific behavior.
- Autonomous runs, interactive sessions, and operator surfaces use compatible but clearly separated paths.

## References

- https://docs.openclaw.ai/concepts
- https://docs.openclaw.ai/reference/session-management-compaction
- https://docs.anthropic.com/en/docs/claude-code/settings
