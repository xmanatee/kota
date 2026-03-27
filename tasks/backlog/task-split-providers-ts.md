---
id: task-split-providers-ts
title: Split providers.ts — extract provider interfaces into provider-types.ts
status: backlog
priority: p2
area: core
summary: providers.ts is 265 lines and mixes four provider interfaces (MemoryProvider, KnowledgeProvider, TaskProvider, HistoryProvider) with the ProviderRegistry class and its accessor functions. Extracting the interfaces into provider-types.ts gives each concern its own file.
created_at: 2026-03-27T11:49:42Z
updated_at: 2026-03-27T11:49:42Z
---

## Problem

`providers.ts` is 265 lines and has two distinct concerns: the four provider interfaces (`MemoryProvider`, `KnowledgeProvider`, `TaskProvider`, `HistoryProvider`, lines 24–128) and the `ProviderRegistry` class plus its singleton accessor functions (lines 129–265). The interfaces have no dependency on the registry and can stand alone.

## Desired Outcome

Extract the four provider interfaces into `src/provider-types.ts`:
- Move `MemoryProvider`, `KnowledgeProvider`, `TaskProvider`, and `HistoryProvider` to the new file and export them.

`providers.ts` imports the four interfaces from `provider-types.ts` and retains only `ProviderRegistry`, `ProviderEntry`, and the accessor functions (`initProviderRegistry`, `getProviderRegistry`, `resetProviderRegistry`, `registerDefaultProviders`, `getMemoryProvider`, `getKnowledgeProvider`, `getTaskProvider`, `getHistoryProvider`).

## Constraints

- No behavior changes — structural split only.
- All existing imports of these interfaces from `providers.ts` must continue to resolve (re-export from `providers.ts` if needed).
- No new public API surface beyond what already exists.

## Done When

- `provider-types.ts` exists and exports all four provider interfaces.
- `providers.ts` is measurably shorter (under 160 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
