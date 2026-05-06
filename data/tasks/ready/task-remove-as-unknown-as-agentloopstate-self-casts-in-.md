---
id: task-remove-as-unknown-as-agentloopstate-self-casts-in-
title: Remove as-unknown-as AgentLoopState self-casts in AgentSession by structurally implementing the loop-state contract
status: ready
priority: p2
area: core
summary: Drop the 4 'as unknown as AgentLoopState' self-casts in core/loop/loop.ts by aligning AgentSession's field declarations with the AgentLoopState interface so the class structurally implements its own internal state contract.
created_at: 2026-05-06T07:01:52.846Z
updated_at: 2026-05-06T07:01:52.846Z
---

## Problem

`src/core/loop/loop-init.ts` declares `AgentLoopState` — the typed
state surface every extracted free helper (`runInitModules`,
`saveToHistoryImpl`, `runClose`, `runSend`, `bindRenderingTransport`,
`restoreConversationIfRequested`) operates on. The same fields live on
the `AgentSession` class in `src/core/loop/loop.ts`, but with mismatched
visibility and definite-assignment markers (`historyEnabled!: boolean`,
`private` modifiers, etc.). The class therefore cannot be passed to its
own helper functions without breaking type-checking, so every call site
casts:

```ts
initAgentSession(this as unknown as AgentLoopState, options, ...);
runSend(this as unknown as AgentLoopState, prompt);
saveToHistoryImpl(this as unknown as AgentLoopState);
runClose(this as unknown as AgentLoopState, errored);
```

Four `as unknown as AgentLoopState` casts at the core agent-loop
boundary. The class casts itself to its own state-shape interface
through `unknown` because the field declarations in `AgentSession`
don't structurally satisfy `AgentLoopState`. That is the canonical
strict-types-policy violation called out in the root `AGENTS.md`:
internal protocol data flowing through `unknown` defeats the typed
boundary the helpers were extracted around.

The strict-types-policy baseline records `src/core/loop/loop.ts: 4` —
all four entries are these self-casts.

## Desired Outcome

`AgentSession` structurally satisfies `AgentLoopState` so the four
`as unknown as AgentLoopState` casts in `loop.ts` collapse to plain
`this` references. The helper free functions still receive a typed
`AgentLoopState` argument (no widening, no permissive overload). The
strict-types-policy baseline drops `src/core/loop/loop.ts` from `4` to
`0` and the regenerate flow shows no new offenders elsewhere.

## Constraints

- Do not widen `AgentLoopState` to `any`/`unknown`/`Record<string,
  unknown>` to make the cast unnecessary. The interface stays a strict
  shape; the class field declarations move to satisfy it.
- Do not introduce a parallel "permissive" alias such as
  `AgentLoopStateLoose` or a `WeakAgentLoopState` extension. There is
  one state contract; `AgentSession` implements it.
- Field visibility on `AgentSession` may need to change (e.g. dropping
  `private` for fields the helpers read) — this is fine as long as the
  field is part of the documented `AgentLoopState` contract. Truly
  private fields that helpers don't touch stay `private`.
- Definite-assignment (`!`) markers stay where the field is assigned
  during `initAgentSession` rather than the constructor body; the
  matching `AgentLoopState` field type already covers that case
  because the interface declares the post-init shape.
- The rule applies equally to `AgentSession`'s test surface: any test
  that constructed a hand-rolled `AgentLoopState` mock continues to do
  so against the same interface, with no change.
- No backwards-compatibility shim that keeps the old cast around as a
  fallback inside `loop.ts` or anywhere else. The casts are removed.

## Done When

- `src/core/loop/loop.ts` declares `class AgentSession implements
  AgentLoopState` (or an equivalent structural-satisfaction edit) and
  passes `this` to `initAgentSession`, `runSend`, `saveToHistoryImpl`,
  and `runClose` without any `as unknown` casts.
- `grep -n "as unknown as AgentLoopState" src/core/loop/loop.ts` returns
  zero hits.
- `pnpm typecheck` and `pnpm test` pass.
- `src/strict-types-policy-baseline.json` is regenerated per
  `src/AGENTS.md`; the diff drops `src/core/loop/loop.ts` from `4` to
  `0` (or removes the entry entirely) and shows no new offenders
  elsewhere.

## Source / Intent

KOTA's strict-by-default rule (root `AGENTS.md`, `## Strict by
Default`) explicitly forbids `as unknown` round-trips through internal
trusted code: "Do not re-validate values already validated at the
boundary. Do not null-check parameters of private functions." The four
self-casts in `loop.ts` are the canonical anti-pattern: a class casts
itself to its own state-shape interface through `unknown` because the
class fields don't structurally satisfy the interface they were
extracted around. This task continues the recent strict-typed-
protocol direction landed by
`task-tighten-daemonsseevent-to-a-typed-discriminated-un`, which
removed 13 narrowing casts at the daemon-handle SSE wiring by giving
the discriminator a typed payload. Same pattern, different load-
bearing core boundary.

## Initiative

Strict typed protocols at the core agent-loop boundary: every internal
call into `AgentLoopState`-shaped helpers must pass a structurally
typed value, never an `as unknown` cast that defeats the contract the
helpers were extracted around.

## Acceptance Evidence

- A diff that removes the four `as unknown as AgentLoopState` casts in
  `src/core/loop/loop.ts` and replaces them with plain `this`
  references against an `implements AgentLoopState` declaration (or
  equivalent structural satisfaction).
- A regenerated `src/strict-types-policy-baseline.json` showing
  `src/core/loop/loop.ts` dropped from 4 to 0 (or the entry removed),
  with no new offenders elsewhere.
- `pnpm test` and `pnpm typecheck` transcripts under the run directory
  showing both green.
