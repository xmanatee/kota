---
id: task-refactor-telegram-status-poll
title: refactor telegram status-poll
status: done
priority: p3
area: channel
task_class: Platform
summary: Split the oversized Telegram status polling module while preserving behavior.
created_at: 2026-06-19T16:16:43.695Z
updated_at: 2026-06-20T20:21:00.000Z
---

## Problem

`src/modules/telegram/status-poll.ts` was 1123 lines. The polling, state, formatting, and channel concerns were too concentrated for clean autonomous changes.

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

## Result

`src/modules/telegram/status-poll.ts` is now a 164-line poll-loop and compatibility export surface. Command dispatch/rendering, project-scoped status resolution, status text rendering, and shared types now live in focused Telegram module helpers:

- `src/modules/telegram/status-commands.ts`
- `src/modules/telegram/status-scope.ts`
- `src/modules/telegram/status-render.ts`
- `src/modules/telegram/status-types.ts`

The poller delegates slash-command handling to the same shared command path used by runtime evidence tests.

## Acceptance Evidence

- Line count: before 1123 lines; after 164 lines for `src/modules/telegram/status-poll.ts`.
- Static exports/callers: `status-poll.ts` still re-exports `handleTelegramStatusCommand`, `buildStatusText`, the public types, and `startTelegramStatusPoll`; current callers still import from `./status-poll.js`.
- Rendered Telegram evidence:
  `.kota/runs/2026-06-20T20-13-21-622Z-builder-nyfcby/digest-consolidation/surface-runtime-evidence/telegram/digest-command-runtime.md`,
  `.kota/runs/2026-06-20T20-13-21-622Z-builder-nyfcby/recall-consolidation/surface-runtime-evidence/telegram/recall-command-runtime.md`,
  `.kota/runs/2026-06-20T20-13-21-622Z-builder-nyfcby/capture-consolidation/surface-runtime-evidence/telegram/capture-command-runtime.md`.
- Validation passed: focused status-poll/runtime tests, Telegram project-scope and daemon integration tests, and `pnpm typecheck`.
- `pnpm validate-tasks` is blocked in this sandbox because `.git/index.lock` cannot be created for the required task move staging; the task was moved by content patch fallback and the failure is recorded in the run artifacts.

## Source / Intent

Owner follow-up on 2026-06-19: create first-wave refactor tasks for the oversized changed production files so autonomous agents can reduce future review risk.

## Initiative

N/A - scoped maintenance.
