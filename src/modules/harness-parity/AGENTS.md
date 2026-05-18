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
- This module also owns the `harnessParity` `KotaClient` namespace
  (`harness-parity-operations.ts`). CLI action handlers consume
  `ctx.client.harnessParity.<method>()`; the local handler and the
  daemon-control routes (`controlRoutes` at `/harness-parity/*`) call the
  same shared helpers, so daemon-up and daemon-down callers see the same
  scenario list and run summary.

## Artifact Shape

Per harness run the module writes:

- `prompt.txt` — the exact prompt handed to the adapter.
- `trace.txt` — tail of everything the adapter streamed through
  `AgentHarnessWriter`.
- `trace-summary.md` — operator-facing digest (harness, model, turns, cost,
  verification verdict, changed files) plus the adapter capability boundary
  before streamed text.
- `trajectory.json` — ordered `KotaAgentMessage` frames captured through
  `AgentHarnessRunOptions.onMessage` when the harness declares
  `emitsAgentMessageStream: true`, or an explicit unsupported record when it
  does not.
- `trajectory-summary.md` — concise action/observation sequence for tool
  calls, tool results, status frames, and final result frames; oversized tool
  results are bounded with an explicit truncation marker.
- `diff.patch` — `git diff --no-index` output against the scenario's
  `initial/` tree.
- `verification.json` — command, timeout, exit status, and tail of combined
  stdout/stderr.
- `run-meta.json` — structured record including any adapter error and the full
  `AgentHarness` capability snapshot observed before the run: tool-control
  mode, owner-question tool name, message-stream support, supported hook kinds,
  unsupported neutral run options, and optional local readiness data.

The top-level `parity.json` keeps compact capability and trajectory metadata
beside each harness outcome so side-by-side comparison does not require
opening every child run directory.

## Scenario Coverage

The shipped scenarios span six coverage points by design, not by accident:

- A minimal smoke scenario that any tool-calling harness can clear in a
  single round trip. Its job is to prove the parity plumbing — scenario
  load, working-dir materialization, adapter invocation, verification,
  diff capture — survives end-to-end without masking trivial wiring bugs.
- A multi-file, multi-turn scenario that requires reading several files,
  deriving correct content from what was read, writing more than one
  file, and running the verification command through the tool loop. Its
  job is to probe the capability the "general-purpose coding agent
  across pluggable harnesses" claim actually rests on. A text-only
  adapter (`thin`) cannot clear it — that failure is evidence, not a bug.
- A failure-and-revise scenario whose expected value is derived at test
  time from an opaque transform and only surfaces in the assertion
  failure output. Its job is to probe tool-result fidelity across turns:
  a harness that silently truncates, drops, or fails to carry tool-result
  bytes back into the agent's next turn cannot clear it, because the
  agent's only path to the expected value runs through the failure
  message. This is the property every real debugging workflow rests on.
- A discovery scenario whose prompt names only the symptom — `node
  test.js` fails — and intentionally does not name the source file the
  agent must edit. The `initial/` tree carries realistic distractor
  files alongside the one buggy file, and `test.js` does not import the
  buggy file directly. Its job is to probe the discovery dimension a
  real operator's prompt depends on: a harness that can read files but
  cannot effectively search the project (no grep, glob, or directory
  listing in the autonomous tool loop, or one that stops after the first
  file it reads) clears the smoke / multi-file / failure-and-revise
  fixtures and quietly fails this one. Real operators say "this test is
  failing" and expect the agent to navigate the project on its own.
- A cross-file rename scenario whose prompt names only the rename
  target ("rename function `format` to `renderLine`") and the
  verification command. The `initial/` tree defines the function in
  one source file and exercises it through three or more caller files
  via an entry module that `test.js` imports; `test.js` itself does
  not import the renamed function. Its job is to probe the rename
  discipline real refactor work depends on: a harness that touches the
  definition but misses at least one call site leaves the project in a
  partial state where the unchanged callers reference an undefined
  symbol and crash the moment `test.js` exercises their code path.
  This isolates cross-file consistency under rename — the property a
  harness that "fixes" only files it already opened, or that stops
  after the obvious first edit, silently fails.
- A frontend-preview scenario whose verifier starts a deterministic
  loopback static server, falls back to filesystem reads when sockets are
  unavailable, checks DOM/CSS-visible state, and writes `preview.html`
  plus `preview-check.json`. Its job is to probe the local rendered-
  output workflow that frontend work depends on.

Keep all six coverage points alive. Adding another scenario is fine, but
do not delete existing fixtures: smoke catches plumbing regressions,
multi-file probes multi-turn coding, failure-and-revise probes tool-
result carry-over, discovery probes project navigation, rename probes
cross-file consistency, and frontend-preview probes local rendered-output
evidence. Each isolates a different blast radius.

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
