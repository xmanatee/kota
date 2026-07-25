---
id: task-fix-cross-hierarchy-signal-routing
title: Fix cross-hierarchy signal routing from downstream failure evidence
status: ready
priority: p2
area: eval-harness
summary: Trace the pressure-alarm routing failure from the gateway symptom to the upstream channel registry root cause, fix the registry, and write structured debug evidence.
created_at: 2026-07-07T23:04:35.954Z
updated_at: 2026-07-07T23:04:35.954Z
---

## Problem

`node --test test/signal-flow.test.mjs` fails in the gateway-facing signal
dispatch tests. The visible failure says a line-a pressure alarm is routed to
`queue/ambient-monitor` instead of `queue/safety-cutoff`, but the gateway only
renders the routing decision it receives from lower layers.

The root cause is upstream in the hierarchy lookup path. Fix the upstream cause
instead of patching the gateway symptom.

## Desired Outcome

Pressure signals under both line-a and line-b resolve through the nearest
ancestor pressure rule, adjacent temperature routing still resolves through its
own rule, and the gateway emits the correct queue topics and matched rule keys.

Write `debug-trace-result.json` with:

- the failing command and output excerpt used as evidence;
- the downstream symptom file/layer where the failure first appeared;
- the upstream root-cause file/layer that was changed;
- the causal path through gateway, signal-flow, and registry layers; and
- the verification command and passing result after the fix.

Use this verification command:

```sh
node scripts/check-debug-trace.mjs
```

## Constraints

- Keep the project dependency-free; use built-in Node.js APIs.
- Do not edit `scripts/check-debug-trace.mjs` or
  `test/signal-flow.test.mjs`; they are the fixture-owned verifier.
- Do not patch `src/gateway.mjs` or `src/signal-flow.mjs` to special-case the
  visible failure. The accepted implementation change is in
  `src/channel-registry.mjs`.
- Do not hardcode the concrete failing signal paths. The verifier checks
  sibling pressure and temperature paths that should resolve through the same
  ancestor-prefix rules.
- Do not write a plausible trace artifact without validating the fixed runtime
  behavior. The verifier checks the artifact against current behavior.

## Done When

- `src/channel-registry.mjs` resolves hierarchical signal paths by considering
  nearest ancestor prefixes before broader site-level fallbacks.
- `node --test test/signal-flow.test.mjs` exits successfully.
- `node scripts/check-debug-trace.mjs` exits successfully and validates
  `debug-trace-result.json`.
- `debug-trace-result.json` names `src/gateway.mjs` as the symptom file,
  `src/channel-registry.mjs` as the root-cause file, and includes the full
  causal path and verification result.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-debug-trace.mjs`.
- The generated `debug-trace-result.json` artifact.
- Command output from `node scripts/check-debug-trace.mjs --self-test-shortcuts`.
- The fixture run artifact records the `regression_cases_passed` objective
  metric.

## Source / Intent

Eval-harness fixture seed for measuring cross-hierarchy debugging. The point is
to prove a builder can follow a concrete downstream failure through interacting
files, patch the root cause, and leave structured evidence rather than changing
the first symptom file named by a failing assertion.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include root-cause
debugging across local call hierarchies, not only localized symptom fixes.
