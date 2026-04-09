---
id: task-telegram-module-boundary
title: Move telegram implementation files into the module directory
status: done
priority: p2
area: architecture
summary: src/telegram.ts, src/telegram-client.ts, and src/workflow/telegram-status-poll.ts are telegram-specific implementation files living outside the module boundary in the core src/ root and workflow directory.
created_at: 2026-04-08T21:15:00Z
updated_at: 2026-04-08T21:15:00Z
---

## Problem

The telegram module (`src/modules/telegram/index.ts`) imports its core
implementation from outside its own directory:

- `src/telegram.ts` — `TelegramBot` class; owned exclusively by the telegram module
- `src/telegram-client.ts` — `callTelegramApi` HTTP helper; owned exclusively by the telegram module
- `src/workflow/telegram-status-poll.ts` — telegram-specific status polling loop; also imported only by the telegram module

All three files are only consumed by the telegram module and `src/modules/telegram/AGENTS.md` explicitly notes the status poll "lives in `src/workflow/telegram-status-poll.ts`" as an acknowledged exception. This violates the module-boundary principle: implementation files that belong to an module should live inside the module's own directory, not in the core root or a shared workflow directory.

The recent tool-group-policy and risk-annotation migrations moved similar module-specific policy out of core. Telegram implementation is the next bounded migration in the same direction.

## Desired Outcome

- `src/telegram.ts` → `src/modules/telegram/bot.ts`
- `src/telegram-client.ts` → `src/modules/telegram/client.ts`
- `src/workflow/telegram-status-poll.ts` → `src/modules/telegram/status-poll.ts`
- `src/modules/telegram/index.ts` updates its imports to use local paths (`./bot.js`, `./client.js`, `./status-poll.js`)
- `src/modules/telegram/AGENTS.md` is updated to reflect the new co-located layout

No behavior changes. No new public API surfaces. No changes to the module contract.

## Constraints

- The `callTelegramApi` function must not be re-exported from any core module after the move.
- `src/telegram.ts` and `src/telegram-client.ts` are removed from `src/`; no leftover barrel re-exports.
- `src/workflow/telegram-status-poll.ts` is removed from the workflow directory.
- Existing `src/modules/telegram/telegram.test.ts` may need import updates; no new tests required.
- Do not move `src/channel.ts` — it is the core channel protocol type and belongs in core.
- All existing telegram tests pass after the move.

## Done When

- `src/telegram.ts` and `src/telegram-client.ts` no longer exist at the core root.
- `src/workflow/telegram-status-poll.ts` no longer exists in the workflow directory.
- The three files exist under `src/modules/telegram/` with updated imports.
- TypeScript compilation passes with no new errors.
- Existing telegram tests pass.
