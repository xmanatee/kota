# Harness Parity Module

This module owns the operator-facing surface for capturing paired coding-task
artifacts across every registered `AgentHarness`. Its job is to turn the
`AgentHarness.run` contract into comparable evidence — same prompt, same
initial state, same verification predicate, every registered adapter — so the
"general-purpose coding agent across pluggable harnesses" claim can be
judged against real runs rather than aspiration.

## Scope

- Scenarios are self-contained: `scenarios/<id>/scenario.json` plus an
  `initial/` tree that defines the starting repo state. Single-stage
  scenarios declare one prompt and verifier; staged scenarios declare two or
  three ordered stages, each with its own prompt and verifier.
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
- `trajectory-diagnostics.json` — deterministic advisory process-quality
  warnings from the shared core `KotaAgentMessage` diagnostics helper, such
  as missing post-edit verification, blind failing-command retries, edits
  after a passing verification, and missing frames from a streaming-capable
  harness.
- `context-retrieval-diagnostics.json` — deterministic advisory diagnostics,
  written only for scenarios or stages that declare `contextRetrieval`
  targets, showing whether search/read/navigation actions reached expected
  files or globs before the first implementation edit.
- `diff.patch` — `git diff --no-index` output against the scenario's
  `initial/` tree.
- `verification.json` — command, timeout, exit status, and tail of combined
  stdout/stderr.
- `run-meta.json` — structured record including any adapter error and the full
  `AgentHarness` capability snapshot observed before the run: tool-control
  mode, owner-question tool name, message-stream support, supported hook kinds,
  unsupported neutral run options, and optional local readiness data.

Staged scenarios additionally write `stages/<stage-id>/` directories with the
same per-stage prompt, trace, trajectory, diff, verifier, and run-meta files.
The top-level harness directory keeps the final diff plus a compact staged
summary in `run-meta.json`; `parity.json` carries the same per-stage status for
side-by-side comparison.

The top-level `parity.json` keeps compact capability, trajectory, and optional
context-retrieval metadata beside each harness outcome, including warning
counts and artifact paths, so side-by-side comparison does not require opening
every child run directory.

## Scenario Portfolio

Keep the smallest representative set that distinguishes materially different
harness capabilities: tool-loop editing, recovery from feedback, workspace
navigation, rendered output, staged maintenance, and read-only investigation.
Before adding a scenario, name the distinct failure it catches and check
whether an existing scenario can carry that example. Merge or remove scenarios
whose outcomes overlap; scenario identity and fixture count are not contracts.
The current catalog is discoverable from `scenario.json` files and should not
be copied into this instruction file.

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

- Scoring, regression gates, and standalone aggregated pass@k/pass^k metrics
  are eval-harness concerns; harness-parity may record model-matrix parity
  evidence, but it is not a rollout gate.
- Provider credentials, model discovery, or adapter registration. Harnesses
  register themselves through their own modules; this module resolves them
  by name.
- Live execution without an operator authorization step. The autonomous
  builder ships infrastructure under this directory but does not itself
  capture paired artifacts — live runs consume real API budget and should
  be invoked by an operator via `kota harness-parity run`.
