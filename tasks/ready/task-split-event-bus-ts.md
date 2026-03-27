---
id: task-split-event-bus-ts
title: Split event-bus.ts — extract BusEvents catalog into event-bus-types.ts
status: ready
priority: p2
area: refactor
summary: event-bus.ts is 257 lines with ~110 lines of BusEvents type catalog at the top followed by the EventBus class and singleton functions. Extracting the type catalog gives consumers a lightweight import path and keeps the class file focused.
created_at: 2026-03-27T12:06:24Z
updated_at: 2026-03-27T12:06:24Z
---

## Problem

`event-bus.ts` opens with a 110-line `BusEvents` type catalog (all known event payloads), followed by `BusEnvelope`, `BusEventHandler`, the `EventBus` class, and singleton helpers. Files that only need the type catalog must import the full module. The file is approaching the 300-line limit.

## Desired Outcome

Extract `BusEvents`, `BusEnvelope`, and `BusEventHandler` into `src/event-bus-types.ts`. Update `event-bus.ts` to re-export them from the new file. All existing imports continue to work.

## Constraints

- Do not change any public API or runtime behavior.
- All existing imports of `BusEvents`, `BusEnvelope`, and `BusEventHandler` should continue to resolve without modification (re-export from event-bus.ts).
- Keep singleton functions and the `EventBus` class in `event-bus.ts`.

## Done When

- `src/event-bus-types.ts` exists and contains `BusEvents`, `BusEnvelope`, and `BusEventHandler`.
- `src/event-bus.ts` imports from `event-bus-types.ts` and re-exports those types.
- `event-bus.ts` is measurably shorter (at least 100 lines shorter).
- `typecheck` and `test` pass.
