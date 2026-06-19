---
id: task-refactor-telegram-status-poll
title: refactor telegram status-poll
status: ready
priority: p3
area: channel
task_class: Platform
summary: Split the oversized Telegram status polling module while preserving behavior.
created_at: 2026-06-19T16:16:43.695Z
updated_at: 2026-06-19T16:16:43.695Z
---

## Problem

`src/modules/telegram/status-poll.ts` is currently 1123 lines. The polling, state, formatting, and channel concerns are too concentrated for clean autonomous changes.

## Desired Outcome

Split Telegram status polling into smaller, named units while preserving channel behavior, public exports, and operator-visible output.

## Constraints

- Preserve public exports and current Telegram behavior.
- Do not change polling cadence, message content, or state semantics unless the existing behavior is explicitly proven wrong.
- Read the nearest `AGENTS.md` before touching the module directory.
- Keep channel-specific verification evidence visible; this is `area: channel`.

## Done When

- The original file is materially smaller and organized around one clear responsibility.
- Extracted helpers separate polling mechanics, state derivation, and message/rendering concerns where appropriate.
- Static queries show callers and exports remain compatible.
- No leftover duplicate polling paths or unused extracted files remain.

## Source / Intent

Owner follow-up on 2026-06-19: create first-wave refactor tasks for the oversized changed production files so autonomous agents can reduce future review risk.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/telegram/status-poll.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include a Telegram rendered message fixture, transcript, or focused channel probe showing output stayed compatible.
