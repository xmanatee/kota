---
status: done
---

# Split event-bus.ts — extract BusEvents catalog into event-bus-types.ts

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
