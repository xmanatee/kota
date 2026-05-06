---
id: task-remove-as-unknown-as-moduleeventproxy-self-cast-in
title: Remove as-unknown-as ModuleEventProxy self-cast in createEventProxy by typing the proxy with overloaded function signatures
status: done
priority: p2
area: core
summary: Tighten createEventProxy in core/modules/module-context.ts so it structurally satisfies ModuleEventProxy without an as-unknown cast, dropping the canonical strict-types-policy violation at the module event-proxy boundary.
created_at: 2026-05-06T07:37:09.023Z
updated_at: 2026-05-06T07:44:04.434Z
---

## Problem

`src/core/modules/module-context.ts` defines `createEventProxy`, the
helper every module receives as `ctx.events` to emit and subscribe on
the core `EventBus`. Its public type is `ModuleEventProxy`
(`src/core/modules/module-types.ts:100`), which mirrors `EventBus`'s
overloaded signatures: typed `BusEvents` keys, typed
`ModuleEventDef`-shaped declarations, a wildcard `"*"` subscriber, and
visibly-unsafe `emitExternal`/`subscribeExternal` escape hatches.

The implementation, however, is built as an object literal whose
`emit`/`subscribe` arrow methods are typed with the loose runtime
shape `(event: unknown, payload: Record<string, unknown>): void`,
because TypeScript does not infer overloaded call signatures from
object-literal arrow properties. The literal therefore does not
structurally satisfy `ModuleEventProxy`, and the function ends with:

```ts
return proxy as unknown as ModuleEventProxy;
```

That is the canonical strict-types-policy violation: internal trusted
code round-trips through `unknown` to satisfy a typed public
interface. The proxy that every module-owned typed event flows through
is one of the most load-bearing core boundaries in KOTA, and the
typed `BusEvents` / `ModuleEventDef` contract is silently bypassed at
construction time. The strict-types-policy baseline records
`src/core/modules/module-context.ts: 15`; the line-101 cast is one of
those entries.

`EventBus` itself shows the correct shape: each of `on`, `once`, and
`emit` is declared as a class method with explicit overload
signatures plus a single combined implementation signature
(`src/core/events/event-bus.ts:30`, `:66`, `:94`). The proxy needs the
same treatment in helper-function form so its assembled object
satisfies `ModuleEventProxy` without a cast.

## Desired Outcome

`createEventProxy` returns a value that structurally satisfies
`ModuleEventProxy` with no `as unknown` cast. Each method on the
returned proxy is built from a standalone function (or class method)
that carries the same overload signatures `ModuleEventProxy`
declares — typed `BusEvents` keys, typed `ModuleEventDef` payloads,
wildcard `"*"` subscriber, and the `emitExternal` /
`subscribeExternal` string-name escape hatches. The strict-types-
policy baseline drops `src/core/modules/module-context.ts` by at
least the entry corresponding to the line-101 cast and the loose
`(event: unknown, ...)` arrow signatures inside the helper, with no
new offenders elsewhere.

## Constraints

- Do not widen `ModuleEventProxy` to make the cast unnecessary. The
  public contract stays a strict overloaded shape; the implementation
  moves to satisfy it.
- Do not introduce a parallel "loose" alias such as
  `ModuleEventProxyLoose`, an `internal-event-proxy` second
  interface, or a permissive overload added solely to make the cast
  legal. There is one event-proxy contract; the implementation
  satisfies it.
- The `emitExternal` and `subscribeExternal` escape hatches keep
  their visibly-unsafe `(event: string, payload: Record<string,
  unknown>)` signatures. Their loose typing is part of the public
  contract, not a leak — do not hide them behind a typed alias.
- The implementation may switch from an object literal to standalone
  overloaded helper functions, or to a small class that
  `implements ModuleEventProxy`. Either is acceptable as long as the
  assembled value satisfies `ModuleEventProxy` directly.
- The runtime behavior of the proxy is unchanged. `isModuleEventDef`
  still routes typed `ModuleEventDef` declarations to their `.name`,
  raw string event names route through directly, and the proxy keeps
  the no-op `() => {}` unsubscribe shape when `getBus()` returns
  `null`.
- Tests that construct hand-rolled `ModuleEventProxy` shapes (e.g.
  `src/core/modules/testing/index.ts`) remain valid against the
  same interface; do not change the public type to accommodate them.
- No backwards-compatibility shim that keeps the old cast around as a
  fallback.

## Done When

- `src/core/modules/module-context.ts` no longer contains
  `as unknown as ModuleEventProxy`. `grep -n "as unknown as
  ModuleEventProxy" src/core/modules/module-context.ts` returns zero
  hits.
- The implementation of each `ModuleEventProxy` method carries the
  same overloaded call signatures the interface declares, either as
  named functions with overloads or as methods on a class that
  `implements ModuleEventProxy`.
- The `(event: unknown, ...)` and
  `handler: (payload: never) => void` parameter signatures inside the
  proxy implementation are replaced with the typed overloads; the
  combined implementation signature may still take `event: string |
  ModuleEventDef` to mirror `EventBus`.
- `pnpm typecheck` and `pnpm test` pass.
- `src/strict-types-policy-baseline.json` is regenerated per
  `src/AGENTS.md`. The diff drops the
  `src/core/modules/module-context.ts` count by at least 1 (covering
  the removed cast) and shows no new offenders elsewhere.

## Source / Intent

Continues the strict-typed-protocol direction landed by
`task-tighten-daemonsseevent-to-a-typed-discriminated-un` (13
narrowing casts removed at the daemon SSE wiring) and
`task-remove-as-unknown-as-agentloopstate-self-casts-in-` (4
self-casts removed at the agent-loop boundary by structurally
implementing the state contract). Same canonical strict-types-policy
violation — internal trusted code round-tripping through `unknown` to
satisfy a typed public interface — at a different load-bearing core
boundary. KOTA's strict-by-default rule (root `AGENTS.md`, `## Strict
by Default`) explicitly forbids `as unknown` round-trips through
internal trusted code. The proxy is the ingress every module uses to
emit and subscribe on the core `EventBus`; tightening its
construction is core hygiene, not a peripheral cleanup.

Queued by explorer 2026-05-06 because the queue was empty (0 ready /
doing / backlog, 19 blocked, 891 done) and the three strategic-area
blocked alternatives — harness-parity capture, auth-walled-source
access, and the rich-CLI Phase 3 peer capture — are all
operator-gated and cannot move autonomously.

## Initiative

Strict typed protocols at the core module event-proxy boundary:
every module's emit/subscribe call must flow through a value that
structurally satisfies `ModuleEventProxy`, never through an
`as unknown` cast that defeats the typed `BusEvents` /
`ModuleEventDef` contract.

## Acceptance Evidence

- A diff that removes `as unknown as ModuleEventProxy` from
  `src/core/modules/module-context.ts` and replaces the loose arrow
  methods inside `createEventProxy` with overloaded function (or
  class-method) signatures matching `ModuleEventProxy`.
- A regenerated `src/strict-types-policy-baseline.json` showing the
  `src/core/modules/module-context.ts` count drop by at least 1, with
  no new offenders elsewhere.
- `pnpm typecheck` and `pnpm test` transcripts under the run
  directory showing both green.
