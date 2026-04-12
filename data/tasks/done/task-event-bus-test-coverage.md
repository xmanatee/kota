---
id: task-event-bus-test-coverage
title: Add test coverage for core event bus and typed event contracts
status: done
priority: p2
area: core
summary: The event bus is foundational infrastructure with zero tests. Subscriber lifecycle, wildcard dispatch, typed event contracts, and edge cases like double-unsubscribe are untested.
created_at: 2026-04-12T12:35:00Z
updated_at: 2026-04-12T13:41:33.468Z
---

## Problem

`src/core/events/event-bus.ts` and `event-bus-types.ts` have no co-located
tests. The EventBus class is the backbone of cross-module coordination —
workflows, channels, the daemon, and notifications all depend on correct
dispatch semantics. Bugs here would cascade silently.

## Desired Outcome

A co-located `event-bus.test.ts` covering the EventBus class behavior:
subscribe/unsubscribe, wildcard listeners, once semantics, emit ordering,
double-unsubscribe safety, `tryEmit` when uninitialized, singleton lifecycle,
and `listenerCount` accuracy.

## Constraints

- Test the public API, not internal data structures.
- Use the singleton helpers (`initEventBus`, `getEventBus`, `resetEventBus`)
  in setup/teardown to verify lifecycle.
- Keep tests focused on dispatch semantics, not on specific event payload
  shapes (those belong in integration tests).

## Done When

- `src/core/events/event-bus.test.ts` exists with tests covering: on/off,
  once auto-unsubscribe, wildcard dispatch, emit fan-out order, tryEmit no-op
  when uninitialized, singleton init/reset, listenerCount.
- All tests pass.
