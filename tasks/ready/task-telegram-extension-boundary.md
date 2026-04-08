---
id: task-telegram-extension-boundary
title: Move telegram implementation files into the extension directory
status: ready
priority: p2
area: architecture
summary: src/telegram.ts, src/telegram-client.ts, and src/workflow/telegram-status-poll.ts are telegram-specific implementation files living outside the extension boundary in the core src/ root and workflow directory.
created_at: 2026-04-08T21:15:00Z
updated_at: 2026-04-08T21:15:00Z
---

## Problem

The telegram extension (`src/extensions/telegram/index.ts`) imports its core
implementation from outside its own directory:

- `src/telegram.ts` — `TelegramBot` class; owned exclusively by the telegram extension
- `src/telegram-client.ts` — `callTelegramApi` HTTP helper; owned exclusively by the telegram extension
- `src/workflow/telegram-status-poll.ts` — telegram-specific status polling loop; also imported only by the telegram extension

All three files are only consumed by the telegram extension and `src/extensions/telegram/AGENTS.md` explicitly notes the status poll "lives in `src/workflow/telegram-status-poll.ts`" as an acknowledged exception. This violates the extension-boundary principle: implementation files that belong to an extension should live inside the extension's own directory, not in the core root or a shared workflow directory.

The recent tool-group-policy and risk-annotation migrations moved similar extension-specific policy out of core. Telegram implementation is the next bounded migration in the same direction.

## Desired Outcome

- `src/telegram.ts` → `src/extensions/telegram/bot.ts`
- `src/telegram-client.ts` → `src/extensions/telegram/client.ts`
- `src/workflow/telegram-status-poll.ts` → `src/extensions/telegram/status-poll.ts`
- `src/extensions/telegram/index.ts` updates its imports to use local paths (`./bot.js`, `./client.js`, `./status-poll.js`)
- `src/extensions/telegram/AGENTS.md` is updated to reflect the new co-located layout

No behavior changes. No new public API surfaces. No changes to the extension contract.

## Constraints

- The `callTelegramApi` function must not be re-exported from any core module after the move.
- `src/telegram.ts` and `src/telegram-client.ts` are removed from `src/`; no leftover barrel re-exports.
- `src/workflow/telegram-status-poll.ts` is removed from the workflow directory.
- Existing `src/extensions/telegram/telegram.test.ts` may need import updates; no new tests required.
- Do not move `src/channel.ts` — it is the core channel protocol type and belongs in core.
- All existing telegram tests pass after the move.

## Done When

- `src/telegram.ts` and `src/telegram-client.ts` no longer exist at the core root.
- `src/workflow/telegram-status-poll.ts` no longer exists in the workflow directory.
- The three files exist under `src/extensions/telegram/` with updated imports.
- TypeScript compilation passes with no new errors.
- Existing telegram tests pass.
