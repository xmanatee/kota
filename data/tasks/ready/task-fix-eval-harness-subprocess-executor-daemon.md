---
id: task-fix-eval-harness-subprocess-executor-daemon
title: Fix eval-harness subprocess-executor so queued workflow runs actually execute
status: ready
priority: p1
area: eval-harness
summary: The eval-harness subprocess-executor spawns `kota workflow trigger` but never runs a daemon in the fixture's isolated HOME/KOTA_PROJECT_DIR, so pending runs never execute and every fixture times out. Close that gap so `pnpm kota eval run` can actually finish shipped smoke fixtures end-to-end.
created_at: 2026-04-24T14:00:00.750Z
updated_at: 2026-04-24T14:00:00.750Z
---

## Problem

`src/modules/eval-harness/subprocess-executor.ts` runs each fixture by
spawning `node bin/kota.mjs workflow trigger <name> --force --payload ...`
in a tmpdir with `HOME` and `KOTA_PROJECT_DIR` remapped to that tmpdir,
then polling `<workingDir>/.kota/runs/` for a terminal run. The `kota
workflow trigger` command only enqueues a pending run into
`WorkflowRunStore` — if `DaemonControlClient.fromStateDir()` finds no
`daemon-control.json` in the target project (which a fresh fixture
tmpdir never has), the command returns after writing the pending run
and exits. Nothing executes the queued run, so the poll always exhausts
`budgetMs`.

Reproduced locally against the already-shipped smoke fixture:

```
pnpm kota eval run --fixture dispatcher-emits-on-ready-queue --repeats 1
# → pass@k=0.0% pass^k=0.0% ; fixture-run.outcome = timeout ; 0 events.
```

Every prior builder attempt at
`task-add-decomposer-shoulddecompose-false-smoke-fixture` (runs under
`.kota/eval-runs/2026-04-24T13-00-04-083Z/` and earlier) hit the same
shape: `decomposer runs: 0`, shell predicate exits 1 because no
decomposer run exists. The eval-harness contract assumes the subprocess
actually runs the workflow, but no daemon or single-pass runner is
spawned anywhere in the subprocess-executor or in `cli.ts` /
`cadence-workflow.ts`.

This blocks every smoke and real-failure fixture that depends on
`pnpm kota eval run` for its passing signal — including
`dispatcher-emits-on-ready-queue` today and
`task-add-decomposer-shoulddecompose-false-smoke-fixture` (blocked in
`data/tasks/blocked/`) tomorrow.

## Desired Outcome

`pnpm kota eval run --fixture dispatcher-emits-on-ready-queue --repeats 1`
finishes with `outcome: pass` on the default host class. The
subprocess-executor path actually executes queued runs so every shipped
fixture that declares `run-emits-event` / `run-omits-event` predicates,
or checks the triggered workflow's own `.kota/runs/<id>/metadata.json`,
can prove behavior — not just schema validity.

The fix stays inside the eval-harness module. No fixture has to opt in;
the subprocess-executor is the single shared entry point for the CLI,
HTTP route, and cadence workflow, so whatever change lands benefits all
three equally.

## Constraints

- Keep the harness's fixture isolation honest. Each fixture still runs
  in its own tmpdir with `HOME`/`KOTA_PROJECT_DIR` remapped; no state
  leaks between fixtures or into the operator's real repo.
- The solution must not require the operator to start a separate daemon
  process before running `pnpm kota eval run`. That would collapse the
  isolation contract and silently route fixture traffic to the
  operator's live daemon.
- Do not introduce a parallel "in-memory" execution path that bypasses
  the normal workflow runtime. The harness's job is to measure the real
  runtime, not a shim of it.
- Pick one mechanism and commit to it:
  1. Spawn a one-shot daemon per fixture run (start, drain pending runs
     to terminal, shut down), OR
  2. Add a `kota workflow exec` / `--run-inline` surface that executes
     a single workflow run synchronously without the daemon control
     plane, and teach the subprocess-executor to call it, OR
  3. Drain pending runs directly from the subprocess-executor using the
     existing run-executor, using a purpose-built single-pass harness
     driver.
  Evaluate the tradeoffs in code/commit message; do not leave two
  partial paths.
- Agent-step fixtures (improver, decomposer's `shouldDecompose: true`
  branch) are out of scope — they still cost real LLM calls. This task
  only has to make non-agent and skipped-agent-step fixtures actually
  run.
- Follow the autonomy rule: no cost signals leak into agent-facing
  context. Any new tool or CLI surface must not start propagating run
  cost through prompts.

## Done When

- `pnpm kota eval run --fixture dispatcher-emits-on-ready-queue
  --repeats 1` finishes with `outcome: pass` and all four predicates
  pass on the default host class.
- A fixture whose predicates inspect the triggered workflow's own
  `.kota/runs/<id>/metadata.json` (for example, the dispatcher fixture
  plus a decision-only fixture like the one described in
  `task-add-decomposer-shoulddecompose-false-smoke-fixture`) can
  observe the metadata file the subprocess actually produced.
- The subprocess-executor's `kind: "timeout"` path is still exercised
  by a focused test when the inner executor genuinely exceeds
  `budgetMs`, so the budget-aware outcome signal does not regress.
- `src/modules/eval-harness/AGENTS.md` still documents only the shape
  contract, provenance rule, and scoring invariants — no per-mechanism
  inventory.
- `task-add-decomposer-shoulddecompose-false-smoke-fixture` moves out
  of `blocked/` (in a follow-up run) once this enabler ships.
