---
id: task-record-resolved-agent-harness-id-in-every-workflow
title: Record resolved agent harness id in every workflow run artifact
status: done
priority: p2
area: architecture
summary: When a workflow agent step runs, record which AgentHarness adapter actually resolved (not just the static step config) alongside model and effort in the run artifact, so the pluggable-harness claim has ambient runtime evidence rather than relying only on harness-parity scenario captures.
created_at: 2026-04-22T23:45:03.435Z
updated_at: 2026-04-23T00:01:21.204Z
---

## Problem

`src/core/agent-harness/` now registers three adapters (`claude-agent-sdk`,
`thin`, `openai-tools`), and `src/core/workflow/steps/step-executor-agent.ts`
resolves a harness for every agent step via `resolveAgentHarness(step.harness)`.
What is not recorded anywhere in the run artifact is *which adapter actually
resolved*. The static step config in `<run-dir>/workflow.json` carries
`model` and `effort` but omits the harness field whenever the step relies on
the registry default. The `<run-dir>/steps/<step>.json` agent-step output
records `sessionId`, `turns`, `totalCostUsd`, and tool telemetry, but never
the harness name or the resolved model string.

As a result, the "general-purpose coding agent across pluggable harnesses"
claim has no ambient evidence in autonomous runs. A change to
`KotaConfig.defaultAgentHarness` or to the registry resolution order would be
invisible to a future reader of `.kota/runs/`. The only place the adapter
identity shows up today is the `harness-parity` scenario module, which fires
only when an operator manually invokes `kota harness-parity run` and consumes
live API budget.

## Desired Outcome

Every agent step's run artifact (the per-step JSON the runtime already writes)
records the resolved harness identity and the resolved model used for the
call. The artifact field names are stable and consumed by the web UI run
detail, CLI run readouts, and any future eval-harness fingerprinting without
each consumer re-deriving the value from `workflow.json`. Regression tests
cover the case where a step has no explicit `harness` and still resolves to
the registry default, and the case where a step explicitly overrides
`harness`.

## Constraints

- Record the harness identifier the registry actually returned, not the
  optional `step.harness` field. `resolveAgentHarness(undefined)` returning
  the default must still land a concrete name in the artifact.
- Record the model the adapter ran with, not only the raw `step.model`
  before `resolveAgentModel` expansion. Operators should be able to tell
  whether an `xhigh` Opus 4.7 call actually used the Opus 4.7 identifier or
  a fallback.
- Do not add a new "run metadata" surface parallel to the existing per-step
  JSON. Extend the agent-step output schema that
  `src/core/workflow/steps/step-executor-agent.ts` already writes.
- Do not introduce a runtime tool or adapter hook just to capture this —
  both values are already in scope at the resolution site. Capture them
  where they live, not through a second plumbing path.
- Keep the shape minimal. `harness: string` and `model: string` at the
  top level of the agent-step output is enough; no nested capability
  matrix or config snapshot.
- Update any consumer that currently reads model/effort from
  `workflow.json` to prefer the per-step runtime values when present, so
  the ambiguity is removed end-to-end. If no consumer reads the value yet,
  note the first intended consumer in the task notes rather than adding a
  speculative reader.
- No feature flag or dual path — either the field is present on every new
  agent-step artifact or the task is not done.

## Done When

- Every agent step's per-step JSON artifact under
  `.kota/runs/<run-id>/steps/<step>.json` carries `harness` and `model`
  fields populated from the values `step-executor-agent.ts` actually
  passed into `runAgentHarness`.
- A test in `src/core/workflow/steps/` (or adjacent) covers at minimum two
  cases: a step with no explicit `harness` resolves the registry default
  and lands a concrete name; a step with `harness: "thin"` (or another
  registered adapter) lands that exact name.
- The CLI run readout or web UI run-detail surface already covered by
  `#core/repl` / `src/modules/web` paths surfaces the adapter identity
  alongside model, so an operator scanning run history can tell which
  harness produced which run.
- `src/core/workflow/steps/AGENTS.md` or the nearest scoped `AGENTS.md`
  documents the new fields at convention level — no per-field inventory.
- The two blocked harness-related tasks
  (`task-capture-an-end-to-end-coding-task-parity-artifact-`,
  `task-surface-project-selection-in-operator-clients-for-`) remain
  untouched by this change; this task is about ambient runs, not the
  harness-parity scenario module.
