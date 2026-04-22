# Harness Parity Module

This module owns the operator-facing surface for capturing paired coding-task
artifacts across every registered `AgentHarness`. Its job is to turn the
`AgentHarness.run` contract into comparable evidence — same prompt, same
initial state, same verification predicate, every registered adapter — so the
"general-purpose coding agent across pluggable harnesses" claim can be
judged against real runs rather than aspiration.

## Scope

- Scenarios are self-contained: `scenarios/<id>/scenario.json` plus an
  `initial/` tree that defines the starting repo state. Verification is a
  single shell command whose exit status is the pass/fail signal.
- The runner reuses `runAgentHarness` — the same entry point the main `kota
  run` path calls. No parallel benchmarking framework lives here.
- Every harness runs against a fresh `tmpdir` copy of the scenario's
  `initial/` tree. The scenario source is never mutated.
- Paired artifacts land under a single operator-chosen output directory with
  one subdirectory per harness, plus a top-level `parity.json` summarizing
  the comparison.

## Artifact Shape

Per harness run the module writes:

- `prompt.txt` — the exact prompt handed to the adapter.
- `trace.txt` — tail of everything the adapter streamed through
  `AgentHarnessWriter`.
- `trace-summary.md` — operator-facing digest (harness, model, turns, cost,
  verification verdict, changed files).
- `diff.patch` — `git diff --no-index` output against the scenario's
  `initial/` tree.
- `verification.json` — command, timeout, exit status, and tail of combined
  stdout/stderr.
- `run-meta.json` — structured record including any adapter error.

## Capability Gap Handling

Harnesses differ in capability. A text-only adapter (e.g. `thin`) cannot
apply file edits, so a coding-task scenario will record a verification
failure with an empty diff rather than a successful fix. That is not a bug
in the harness or the scenario — it is the capability boundary the task
exists to measure.

- When the boundary is inherent (text-only adapter on a coding task), the
  artifact is the evidence and the gap is recorded in `trace-summary.md`.
- When the gap is a KOTA bug against a capable adapter, convert it to a
  follow-up task rather than suppressing the artifact.

## What Does Not Belong Here

- Scoring, regression gates, and aggregated pass@k/pass^k metrics. Those
  are eval-harness concerns; this module is about *parity evidence*, not
  *capability regression gating*.
- Provider credentials, model discovery, or adapter registration. Harnesses
  register themselves through their own modules; this module resolves them
  by name.
- Live execution without an operator authorization step. The autonomous
  builder ships infrastructure under this directory but does not itself
  capture paired artifacts — live runs consume real API budget and should
  be invoked by an operator via `kota harness-parity run`.
