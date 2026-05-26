---
id: task-write-trajectory-quality-diagnostics-for-workflow-
title: Write trajectory-quality diagnostics for workflow agent steps
status: done
priority: p2
area: core
summary: Reuse KOTA-native agent message streams to write deterministic process-quality diagnostics beside normal workflow agent-step artifacts, so builder, explorer, critic, and repair runs expose lucky-pass warnings without requiring a harness-parity run.
created_at: 2026-05-26T03:34:33.853Z
updated_at: 2026-05-26T03:54:00.000Z
---

## Problem

KOTA now writes KOTA-native agent messages for ordinary workflow agent steps as
`steps/<step-id>.events.jsonl`, and it writes harness capability and tool
telemetry artifacts beside those step records. However, the deterministic
trajectory-quality diagnostics added for lucky-pass coding-agent runs only live
under `src/modules/harness-parity/`.

That leaves normal builder, explorer, critic, improver, and repair-loop runs
with the raw material for process-quality inspection but no compact artifact
that flags weak-success shapes. A workflow can finish successfully after blind
retries, missing final verification, or disordered edit/test flow, and an
operator has to manually inspect the event stream to notice that the pass was
less trustworthy than the final outcome suggests.

## Desired Outcome

Every stream-capable workflow agent step writes a deterministic advisory
trajectory-diagnostics artifact beside its existing step artifacts. The
artifact should reuse KOTA-native `KotaAgentMessage` frames and the existing
lucky-pass warning vocabulary where it applies:

- unsupported or missing native message stream evidence;
- missing verification-like command after edits;
- repeated identical failing commands without an intervening edit;
- successful verification followed by further edits without a final
  verification;
- long pre-implementation activity without touching files later changed by the
  step.

The normal workflow step result, metadata, and operator-facing summaries should
expose compact counts and artifact paths so successful runs are still
outcome-graded while their process quality is visible.

## Constraints

- Reuse the existing `steps/<step-id>.events.jsonl` stream and
  `KotaAgentMessage` protocol. Do not scrape text transcripts or add a
  provider-specific trajectory schema.
- Move or split the harness-parity diagnostic helper only if needed to avoid a
  core-to-module import. The shared implementation should live at the lowest
  boundary both workflow execution and harness-parity can depend on.
- Keep diagnostics advisory by default. Do not replace workflow success,
  repair-loop checks, critic verdicts, eval predicates, or `pass^k` with a
  process-quality score.
- Do not import AgentLens-Bench, build PTA reference models, or add an LLM
  process judge in this slice.
- Do not write raw prompts, secrets, full tool outputs, or provider-private
  adapter data into the diagnostics artifact. Frame indexes, warning codes,
  bounded command summaries, and artifact paths are sufficient.
- Preserve honest unsupported-stream behavior for harnesses that cannot emit
  native agent messages.

## Done When

- Workflow agent steps write a stable
  `steps/<step-id>.trajectory-diagnostics.json` artifact when native message
  streaming is available, and a bounded unsupported/missing-stream artifact
  when the resolved harness cannot or does not emit frames.
- The artifact records versioned counts, warning codes, frame indexes, and
  concise details for the advisory warnings.
- Step metadata or the step result output exposes compact diagnostic counts
  and the artifact path without injecting diagnostics into later agent prompts.
- Harness-parity continues to write its existing trajectory diagnostics using
  the same shared warning implementation or an intentionally thin adapter.
- Focused tests cover a clean workflow trajectory, missing final verification,
  repeated failing command, edit after successful verification, non-streaming
  harness behavior, and an existing harness-parity runner case to prevent
  drift.
- Existing workflow tests and harness-parity diagnostics tests still pass.

## Source / Intent

Explorer run `2026-05-26T03-32-40-781Z-explorer-bc11w4` reviewed an empty
actionable queue. The strategic blocked alternatives were considered, but all
still require operator-captured evidence and are not movable:

- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source: AgentLens, submitted to arXiv on May 13, 2026, evaluates
OpenHands SWE-bench Verified trajectories and reports that passing outcomes can
hide lucky-pass behavior: regression cycles, blind retries, missing
verification, and temporally disordered exploration, implementation, and
verification. It also uses context-sensitive intent labels rather than tool
identity alone, which matches KOTA's preference for deriving process evidence
from typed action streams.

Research links:

- https://arxiv.org/abs/2605.12925
- https://arxiv.org/pdf/2605.12925

Local overlap check:

- `task-add-trajectory-quality-diagnostics-for-lucky-pass-` already added
  advisory trajectory diagnostics to harness-parity artifacts.
- `src/core/workflow/active-run-handle.ts` already persists workflow
  agent-step messages as `steps/<step-id>.events.jsonl`.
- `src/core/workflow/steps/step-executor-agent.ts` already writes harness
  capability and tool telemetry artifacts, but does not write the
  process-quality diagnostic layer for ordinary workflow runs.

The nonduplicative gap is therefore not another benchmark or evaluator agent.
It is making normal autonomous workflow artifacts expose the same deterministic
process-quality warnings that harness-parity runs already expose.

## Initiative

Outcome-grade autonomy evaluation: successful autonomous workflow runs should
remain inspectable for process quality, so operators can distinguish clean
passes from lucky, wasteful, or under-verified passes without abandoning KOTA's
typed artifact and predicate model.

## Acceptance Evidence

- Workflow agent-step diagnostic transcript:
  `.kota/runs/2026-05-26T03-40-41-420Z-builder-xl4wwh/workflow-diagnostics-test-transcript.txt`
  (`pnpm test src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts
  src/core/workflow/run-executor.test.ts`).
- Harness-parity diagnostic transcript:
  `.kota/runs/2026-05-26T03-40-41-420Z-builder-xl4wwh/harness-parity-diagnostics-test-transcript.txt`
  (`pnpm test src/modules/harness-parity/trajectory-diagnostics.test.ts
  src/modules/harness-parity/runner.test.ts`).
- Sample workflow diagnostic artifact:
  `.kota/runs/2026-05-26T03-40-41-420Z-builder-xl4wwh/steps/sample-success.trajectory-diagnostics.json`.
- Static gates passed: `pnpm lint`, `pnpm typecheck`,
  `pnpm test src/strict-types-policy.integration.test.ts`, and
  `pnpm test src/task-files.test.ts`.
- Diff review shows the diagnostic artifact records bounded warning details
  only: counts, warning codes, frame indexes, concise command summaries, and
  artifact paths.
