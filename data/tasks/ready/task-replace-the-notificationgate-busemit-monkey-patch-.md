---
id: task-replace-the-notificationgate-busemit-monkey-patch-
title: Replace the NotificationGate bus.emit monkey-patch with a native EventBus emit-middleware API
status: ready
priority: p2
area: core
summary: Replace the bus.emit monkey-patch in NotificationGate with a native EventBus emit-middleware API so the two as-unknown-as-EmitField self-casts at the quiet-hours gate disappear.
created_at: 2026-05-06T08:12:35.063Z
updated_at: 2026-05-06T08:12:35.063Z
---

## Problem

`src/core/daemon/notification-gate.ts:154,192` patches `EventBus.emit` by
assigning a single-signature wrapper through
`(bus as unknown as EmitField).emit = ...` (and again on `dispose()`).
The cast is the canonical strict-types-policy violation: TypeScript
cannot see the typed-overloaded `emit` (typed `BusEvents` keys, typed
`ModuleEventDef`, custom string events, wildcard) as compatible with
the loose runtime-shape `EmitFn = (event: string, payload:
Record<string, unknown>) => void` the gate replaces it with, so the
helper is round-tripped through `unknown` to land back on the strict
contract. Two `as unknown as` casts at one of the most load-bearing
core daemon primitives — quiet-hours gating is named explicitly in
`src/core/AGENTS.md` and `src/modules/autonomy/AGENTS.md` as a shared
daemon/runtime primitive that every `workflow.attention.digest` and
`workflow.daily.digest` flows through.

The monkey-patch shape also forecloses on future cross-cutting bus
hooks. Anything that needs to observe or transform every emit (a richer
injection-defense interception, observability metrics, per-event rate
limiting) would today have to either add another monkey-patcher beside
the gate or invent its own per-emit hook. The cast is a symptom; the
absence of a typed extension point is the cause.

## Desired Outcome

`EventBus` exposes a typed first-class emit-middleware API. The
`NotificationGate` becomes a normal middleware consumer: it registers a
typed handler that suppresses gated events during quiet hours and falls
through otherwise, holds buffered events, and releases them via a
direct `bus.emit` (or a documented "release" path) without monkey-
patching `bus.emit`. The two `as unknown as EmitField` casts and the
`EmitField` view shape are removed; `notification-gate.ts`'s
strict-types-policy baseline drops by at least 2 (currently 6). No new
offenders elsewhere. Other future cross-cutting hooks have a clean way
to plug in.

## Constraints

- Preserve the existing semantics: gated events (`attention.digest`,
  `daily.digest`) are held during quiet hours and released as a single
  digest when the window ends; non-gated events pass through; `dispose()`
  cleanly removes the gate.
- The middleware API must be typed end-to-end. Do not introduce a new
  `as unknown as` cast or a `Record<string, unknown>` boundary that
  weakens existing typed `BusEvents` / `ModuleEventDef` flows. The same
  overload shape `EventBus` already exposes for `emit` should govern the
  middleware signature.
- Pick one mechanism. Either a single registered middleware with an
  `addEmitMiddleware` returning unsubscribe, or a chain with `next`. Do
  not ship both. Choose the one the gate's release-path needs.
- The release path (`releaseBuffer` re-emitting `attention.digest`)
  must not loop through its own gate. The current code escapes via
  `originalEmit`; the new design should make the bypass explicit and
  typed (e.g. the gate temporarily marks itself non-gating during
  release, or the released digest carries a flag the gate recognizes,
  or the bus exposes a documented direct-dispatch path).
- Keep the gate's existing tests green. Update them only where the
  middleware API replaces the monkey-patch shape, not to weaken
  behavioral coverage.
- No backwards-compatibility shim that keeps the `bus.emit` re-
  assignment working as a fallback.

## Done When

- `EventBus` exposes a typed emit-middleware API (single canonical
  shape, documented in `src/core/events/AGENTS.md` if one exists, or in
  the class JSDoc otherwise).
- `NotificationGate` no longer reassigns `bus.emit`. The two
  `as unknown as EmitField` casts and the `EmitField` type are removed.
- `src/strict-types-policy-baseline.json` is regenerated and
  `src/core/daemon/notification-gate.ts` drops from 6 by at least 2
  (the two cast occurrences). No new offenders elsewhere — the
  strict-types-policy integration test passes.
- The existing `notification-gate` behavior tests still pass: gated
  events held during quiet hours, released as a single digest at window
  end, non-gated events passed through, `dispose()` clean-up.
- The middleware API is exercised by at least the gate; if the test
  surface is thin, add focused unit coverage for the API itself
  (registration, ordering if applicable, suppression, unsubscribe).

## Source / Intent

Continues the strict-typed-protocol thread the past 24 hours have
landed: `task-tighten-daemonsseevent-to-a-typed-discriminated-un`
(2026-05-06 ~05:42), `task-remove-as-unknown-as-agentloopstate-self-`
(~07:07), `task-remove-as-unknown-as-moduleeventproxy-self-cast-in`
(~07:50, commit `26b97de6`). Each one identified a load-bearing core
boundary where a strict typed contract was round-tripped through
`as unknown as` because the runtime helper carried a less-strict
signature, then replaced the monkey-patch / loose-helper shape with a
native typed primitive that drops the cast at its root. The
notification-gate's `EmitField` cast is the next sister target with the
same canonical shape, at a daemon primitive every quiet-hours-gated
notification flows through.

The architectural payoff is that the next cross-cutting bus hook —
likely an injection-defense interception layer or observability tap —
will have a typed extension point waiting instead of another reason to
reach for the monkey-patch escape hatch.

## Initiative

Strict typed core protocols: every load-bearing core boundary should
expose its strict contract as a first-class typed primitive instead of
round-tripping through `as unknown as`. Removes a daemon-primitive
cast and gives `EventBus` the extension point the next cross-cutting
hook would otherwise reinvent.

## Acceptance Evidence

- Diff shows `EventBus` gaining a typed emit-middleware API and
  `NotificationGate` consuming it; the `EmitField` view type and both
  `(bus as unknown as EmitField).emit = ...` lines are deleted.
- `src/strict-types-policy-baseline.json` shows
  `src/core/daemon/notification-gate.ts` dropping from 6 to 4 (or
  lower).
- `pnpm test` passes including the existing notification-gate behavior
  tests and the strict-types-policy integration test
  (`src/strict-types-policy.integration.test.ts`).
- If new middleware-level tests land, they assert registration, the
  release-path bypass shape, and unsubscribe via `dispose()`.
