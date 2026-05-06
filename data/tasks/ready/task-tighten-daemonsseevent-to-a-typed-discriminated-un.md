---
id: task-tighten-daemonsseevent-to-a-typed-discriminated-un
title: Tighten DaemonSseEvent to a typed discriminated union and remove unknown-cast boundary at daemon-handle SSE wiring
status: ready
priority: p2
area: core
summary: Replace the DaemonSseEvent { type; payload: Record<string, unknown> } shape with a discriminated union over the typed bus payloads, removing the as-unknown casts in daemon-handle and tightening every SSE consumer.
created_at: 2026-05-06T06:24:53.130Z
updated_at: 2026-05-06T06:24:53.130Z
---

## Problem

`src/core/daemon/daemon-control-types.ts` defines:

```ts
export type DaemonSseEvent = {
  type: DaemonSseEventType;
  payload: Record<string, unknown>;
};
```

The string-literal-union `DaemonSseEventType` is exhaustive across every
event the daemon SSE surface broadcasts (workflow.started/completed/
step.completed, queue.changed, approval.changed, task.changed,
session.registered/unregistered, owner.question.asked/changed/resolved/
dismissed/expired). Each variant has a typed payload on the upstream core
event bus. Pairing a strict discriminator with a permissive payload
defeats the discriminated-union pattern KOTA otherwise enforces.

The cost shows up in `src/core/daemon/daemon-handle.ts:163-205`, where
the SSE wiring re-emits 13 typed bus events through 13 mechanically-
identical `as unknown as Record<string, unknown>` casts:

```ts
bus.on("workflow.started", (p) => {
  handler({ type: "workflow.started", payload: p as unknown as Record<string, unknown> });
  ...
});
bus.on("workflow.completed", (p) => {
  handler({ type: "workflow.completed", payload: p as unknown as Record<string, unknown> });
  ...
});
// ... and so on for every variant
```

Every downstream consumer (the SSE broadcast loop in
`daemon-control.ts:181`, daemon-chat handlers, KotaClient namespaces,
external client subscribers, and the test fixtures that fan out
`DaemonSseEvent` mocks) then has to re-narrow `payload` from
`Record<string, unknown>` to the actual shape it already had upstream.
This is the canonical strict-types violation called out in the root
`AGENTS.md`: a discriminator without payload narrowing admits illegal
combinations and erases protocol information at the layer most likely
to be observed.

## Desired Outcome

`DaemonSseEvent` is a discriminated union whose variants carry typed
payloads taken directly from the core event-bus payload types (e.g.
`WorkflowStartedPayload`, `WorkflowCompletedPayload`,
`ApprovalChangedPayload`, the typed `queue.changed` body the SSE
boundary already constructs, etc.). `daemon-handle.ts`'s
`subscribeToEvents` emits typed variants without a single `as unknown`
cast, and the strict-types-policy baseline drops 13 entries from the
file (and any further entries in SSE consumers that lose their narrowing
casts).

## Constraints

- Reuse the existing typed payload types from `src/core/events/` and the
  core event-bus declarations. Do not duplicate them under
  `daemon-control-types.ts`. If the SSE-only `queue.changed` payload has
  no upstream type because it is constructed at the daemon handle, lift
  it to its own named type alongside the union and import it from one
  place.
- Strict by default: every variant declares its payload non-optionally;
  never `payload?: T`. Optionality, when it exists, lives on individual
  payload fields, not on the variant itself.
- Exhaustive matching on `event.type` must narrow `event.payload` to the
  exact variant payload — switch consumers do not need any internal
  type assertion to access fields.
- Migrate every consumer in this task. SSE broadcast in
  `daemon-control.ts`, SSE replay in `daemon-control.test.ts`,
  daemon-chat handler suites that mock `subscribeToEvents`, and any
  KotaClient namespace consuming `DaemonSseEvent`. Do not leave a
  parallel "permissive" type alias as a compatibility shim.
- Test fixtures that previously relied on raw `Record<string, unknown>`
  payloads must become typed; if a fixture intentionally emits a
  malformed payload to assert error handling, that scenario keeps a
  narrowly-scoped escape (a separate `DaemonSseRawEvent` type used only
  by the malformed-payload test) — but only if such a test exists, and
  it stays out of the production path.
- Preserve the SSE wire format. Only the in-process types tighten;
  network bytes do not change.
- Strict-types policy baseline updates accept the count drops; do not
  manually re-pad them. Run the regenerate flow per
  `src/AGENTS.md` once the refactor lands so the baseline reflects the
  new totals.

## Done When

- `DaemonSseEvent` in `daemon-control-types.ts` is a discriminated union
  over typed payloads, exported alongside the `DaemonSseEventType`
  string-literal union (or with the literal union derived from the
  variants).
- `daemon-handle.ts`'s `subscribeToEvents` no longer contains any `as
  unknown as Record<string, unknown>` casts and the typed payloads flow
  straight from `bus.on(...)` callbacks into the handler.
- Every direct consumer of `DaemonSseEvent` (SSE broadcast, daemon-chat
  handlers, KotaClient namespaces, test fixtures) compiles without
  internal narrowing casts and switch consumers exhaustively narrow
  `event.payload`.
- `pnpm test` and `pnpm typecheck` pass.
- `src/strict-types-policy-baseline.json` is regenerated and the diff
  shows count drops on `daemon-handle.ts` (and any other consumer that
  shed narrowing casts) without new offenders elsewhere.

## Source / Intent

KOTA's strict-by-default rule (root `AGENTS.md`, `## Strict by
Default`) explicitly calls out discriminated unions as the correct
model for state with distinct shapes and rejects the
`{ type; payload: Record<string, unknown> }` admit-illegal-combinations
form. The strict-types ratchet at `src/strict-types-policy-baseline.json`
records `daemon-handle.ts` at 26 — the highest entry under
`src/core/daemon/` — and 13 of those are the SSE narrowing casts this
task removes. Tightening this surface materially shrinks the strict-
types baseline at a load-bearing protocol boundary every operator
client subscribes to.

## Initiative

Strict typed protocols at the daemon control surface: every public
boundary the daemon exposes — including the SSE event stream — must
carry typed payloads end-to-end so consumers (CLI, web, macOS, mobile,
Telegram, Slack) match exhaustively rather than re-validating shapes
they already know.

## Acceptance Evidence

- A diff that removes `payload: Record<string, unknown>` from
  `DaemonSseEvent`, removes 13 `as unknown as Record<string, unknown>`
  casts from `daemon-handle.ts`, and updates every consumer to the
  typed union.
- A regenerated `src/strict-types-policy-baseline.json` showing count
  drops on `daemon-handle.ts` (and any consumer that lost narrowing
  casts) with no new offenders.
- `pnpm test` and `pnpm typecheck` transcripts under the run directory
  showing both green.
