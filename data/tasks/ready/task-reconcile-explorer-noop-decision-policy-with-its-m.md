---
id: task-reconcile-explorer-noop-decision-policy-with-its-m
title: Reconcile explorer noop-decision policy with its --min-ready 1 repair-loop gate
status: ready
priority: p2
area: architecture
summary: Explorer's repair-loop check hard-codes --min-ready 1 but its decision policy lists noop as valid; align the two so legitimately paused queues do not force fabricated work.
created_at: 2026-05-08T05:40:52.801Z
updated_at: 2026-05-08T05:40:52.801Z
---

## Problem

The explorer workflow holds two contradictory contracts:

- `src/modules/autonomy/workflows/explorer/workflow.ts` declares a
  `task-queue-valid` repair check that runs
  `pnpm run validate-tasks -- --min-ready 1`. The check fails the run
  whenever `data/tasks/ready/` contains zero tasks.
- The explorer prompt and `src/modules/autonomy/workflows/explorer/AGENTS.md`
  ("Decision Order") explicitly enumerate `noop` as one of the legal
  rationale-artifact decisions, alongside `promote`, `decompose`,
  `create-task`, and `watchlist-only`. The prompt direction "Choose an
  explicit no-op when the queue is healthy or no external signal warrants
  change" makes noop a first-class outcome.

When the queue genuinely has no actionable next step — every blocked
task carries a load-bearing `operator-capture` or fresh `owner-decision`
precondition, the only backlog entry is the strategic anchor (`anchor:
true`, skipped by promoter), and the watchlist has no fresh-change
signal — the explorer correctly chooses noop. The repair check then
fires `ready-underflow`, the agent is re-spawned, and the only path
through the gate is to fabricate a task. That defeats the noop policy
and burns agent time.

This was hit live on 2026-05-08T05:33:24Z
(`.kota/runs/2026-05-08T05-33-24-444Z-explorer-pzzsvu/`): explorer
recorded a substantive `exploration-rationale.json` with
`decision: "noop"` and six cited blocked alternatives, then the repair
loop rejected the commit on `task-queue-valid`. The repair attempt
itself had to invent ready work to satisfy the gate.

## Desired Outcome

Explorer's repair-loop policy reflects the same decision space its
prompt and AGENTS.md authorize. Concretely, one of the two contracts
moves so they no longer contradict:

- **Option A (recommended).** The explorer repair-loop drops the
  `--min-ready 1` flavor of `task-queue-valid` and replaces it with a
  rationale-aware check that only fails when the recorded
  `exploration-rationale.json` claims `noop` while
  `inspect-queue.actionableCount === 0` *and* a movable strategic
  blocked alternative exists that the rationale failed to cite or
  rescope. The general-purpose `validate-tasks` script keeps its
  `minReady` option for callers that genuinely want it (operator
  invocations, other workflows, fixture parity), but explorer no longer
  forces it.
- **Option B.** The explorer prompt + AGENTS.md drop `noop` from the
  decision enum and require explorer to always promote, decompose, or
  create-task. This collapses the contradiction in the other direction
  but eliminates a documented pressure-relief valve.

The implementer picks one, justifies the choice in the commit, and
removes the other side's stale wording in the same change.

## Constraints

- Do not relax `validate-tasks` for unrelated callers. The change is
  scoped to the explorer workflow's repair check (or to the explorer's
  decision contract), not to the shared validator's defaults.
- `eval-harness` fixtures currently pin
  `pnpm run validate-tasks -- --min-ready 1` inside the explorer
  workflow's recorded source (e.g.
  `src/modules/eval-harness/fixtures/improver-agent-call-replay/initial/src/modules/autonomy/workflows/explorer/workflow.ts`).
  Update the fixtures the same change touches so replay stays
  deterministic; do not silently let fixtures drift from production
  source.
- Keep the rationale-artifact schema typed. If Option A is taken, the
  new check must read `exploration-rationale.json` through the existing
  `src/modules/autonomy/workflows/explorer/exploration-rationale.ts`
  schema, not by ad-hoc JSON parsing.
- Do not introduce a nullable `minReady?` shim or silent fallback in
  `assertTaskQueueValid`. If the explorer-specific behavior is moved
  out of the shared validator, it lives in the explorer workflow file.
- The change must not let explorer commit on noop without a
  substantive `exploration-rationale.json` (the existing schema test
  in `exploration-rationale.test.ts` stays load-bearing).

## Done When

- Running explorer against a queue with `actionableCount: 0`, an anchor-
  only backlog, and all blocked tasks legitimately gated produces a
  successful run with `decision: "noop"` and **no** `ready-underflow`
  rejection in the repair loop.
- Running explorer against a queue with `actionableCount: 0` and at
  least one strategic blocked alternative whose precondition the
  rationale fails to address still fails the repair loop with a clear
  message naming the un-cited alternative.
- The chosen option's stale text (either the `--min-ready 1` flag or
  the `noop` decision enum) is removed from the explorer workflow,
  prompt, and AGENTS.md in the same change.
- All affected eval-harness fixtures are updated in lockstep so
  `pnpm run test` stays green; no fixture-vs-source drift remains.
- A focused workflow.test.ts case asserts the new explorer repair-check
  behavior on both the legitimate-noop and the should-have-acted shapes.

## Source / Intent

Hit on 2026-05-08T05:33:24Z when explorer recorded a thoughtful noop
rationale citing six legitimately blocked alternatives, then the
`task-queue-valid` repair check rejected the run on `ready-underflow`.
The repair attempt that opened this task is the live evidence that the
two contracts contradict each other. Without the fix, every future
genuinely-paused queue will burn an explorer turn fabricating busywork
instead of letting the operator unblock real work.

## Initiative

Autonomy quality control: the empty-queue loop should let explorer's
documented noop be a real outcome, not a contract that the explorer's
own repair check forbids. Aligning these two surfaces is part of the
broader "Empty-Queue Loop Shape" policy in
`src/modules/autonomy/AGENTS.md`.

## Acceptance Evidence

- A run-directory transcript (or test fixture) under
  `.kota/runs/<run-id>/` showing explorer producing a successful noop
  commit against a queue that previously triggered `ready-underflow`.
- Diff of the explorer workflow + prompt + AGENTS.md showing the
  contradiction removed.
- Updated eval-harness fixtures' `workflow.ts` snapshots reflecting the
  same change, with `pnpm run test` green.
- A new (or extended) `workflow.test.ts` case proving the chosen option
  rejects the should-have-acted shape and accepts the legitimate-noop
  shape.
