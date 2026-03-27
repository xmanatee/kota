---
id: task-split-cli-history-ts
title: Split cli-history.ts — extract registerHistoryCommands into cli-history-commands.ts
status: done
priority: p2
area: refactor
summary: cli-history.ts is 263 lines mixing interactive/pipe loop utilities with the 137-line registerHistoryCommands function. Extracting the command registration into cli-history-commands.ts gives each concern its own file and keeps both under 150 lines.
created_at: 2026-03-27T12:06:24Z
updated_at: 2026-03-27T12:23:00Z
---

## Problem

`cli-history.ts` contains two distinct concerns: REPL/pipe loop helpers (`interactiveMode`, `runPipeLoop`, `resolveRunContinue`, `parseIntOption`, `resolveConversationId`) and the 137-line `registerHistoryCommands` function that registers all history subcommands on the CLI program. The file is at 263 lines and growing.

## Desired Outcome

Extract `registerHistoryCommands` and any helpers used exclusively by it into `src/cli-history-commands.ts`. Update `cli-history.ts` to import and re-export `registerHistoryCommands` so all existing call sites continue to work unchanged.

## Constraints

- Do not change any runtime behavior or public API surface.
- All existing call sites importing `registerHistoryCommands` from `cli-history.ts` should continue to work (re-export from `cli-history.ts`).
- Only move code that is exclusively used by `registerHistoryCommands`; shared utilities stay in `cli-history.ts`.

## Done When

- `src/cli-history-commands.ts` exists and contains `registerHistoryCommands`.
- `cli-history.ts` re-exports `registerHistoryCommands` from the new file.
- Both files are under 200 lines.
- `typecheck` and `test` pass.
