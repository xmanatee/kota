---
id: task-cover-harness-parity-with-a-read-failure-and-revis
title: Cover harness-parity with a read-failure-and-revise scenario
status: done
priority: p2
area: architecture
summary: Add one harness-parity scenario where the agent must run the verification command, observe a failing output, and then change approach — so tool-result fidelity across turns is actually probed, not just straight-line patch-and-verify.
created_at: 2026-04-23T13:03:58.699Z
updated_at: 2026-04-23T13:12:37.528Z
---

## Problem

`src/modules/harness-parity/scenarios/` currently ships two scenarios:
`fix-arithmetic-bug` (single-file 3-line patch) and
`extract-shared-helper` (multi-file refactor). Both are solvable by a
straight-line first-pass edit: the agent reads the files, writes the
correct code, the verification command exits clean. Neither scenario
requires the agent to actually run the verification command, observe a
failure output, and change approach based on what the tool returned.

A harness adapter that silently truncates tool-result content, collapses
`stderr`, drops multi-turn context between tool calls, or fails to carry
observation bytes back into the next prompt would still pass both
scenarios. "Pluggable-harness parity" therefore covers less than the
scenarios suggest — specifically, it does not probe tool-result fidelity
across turns, which is the behavior that matters for every real coding
task where the agent has to debug a failure.

## Desired Outcome

A new scenario lives under `src/modules/harness-parity/scenarios/` whose
pass condition can only be met after at least one verification run has
failed, the agent has observed the failure output, and a subsequent edit
has changed approach based on that output. Concretely: a naive first-pass
guess must not satisfy the verification command; the failure message
itself must carry the information the agent needs to succeed; and a
harness that fails to deliver tool-result bytes back into the agent's
next turn must predictably fail the predicate.

The scenario slots into the existing `kota harness-parity run` path and
produces the same paired-artifact shape (`prompt.txt`, `trace.txt`,
`diff.patch`, `verification.json`, `run-meta.json`, `parity.json`) every
other scenario produces, so operator-facing evidence stays uniform.

## Constraints

- Reuse the existing `Scenario` schema and `runAgentHarness` entry point.
  Do not introduce a parallel scenario format, a new verification mode,
  or a second runner.
- Verification stays deterministic and operator-runnable via a shell
  exit code (e.g. `node test.js`). No judge, no LLM call in the
  verification loop.
- Do not add live-LLM invocation from autonomous runs. This scenario is
  operator-runnable infrastructure, not an ambient eval.
- The `thin` harness (single-turn, text-only) must predictably fail the
  predicate because it cannot host a follow-up turn at all — the
  scenario must not carry a silent pass for it.
- Keep the scenario focused. One failure-and-revise bounce is enough to
  probe the property; a sprawling multi-step debug is overreach.

## Done When

- A scenario directory exists under
  `src/modules/harness-parity/scenarios/` with a `scenario.json`, an
  `initial/` tree, and a failing-first-run design that an operator can
  verify by eye.
- `pnpm kota harness-parity list` surfaces the new scenario.
- The module's `AGENTS.md` is updated only if the new scenario changes
  the module's stated coverage claim; otherwise it stays untouched.
- A focused test under `src/modules/harness-parity/` confirms the
  scenario loads and the initial tree fails the verification command
  before any edit. Trace-content assertions across harnesses stay out —
  those belong to operator-run live capture, which is the separate
  blocked task.
