---
id: task-record-harness-capability-boundaries-in-parity-artifacts
title: Record harness capability boundaries in parity artifacts
status: ready
priority: p2
area: modules
summary: Extend harness-parity artifacts so every run records the resolved adapter capability boundary, including tool-control mode, unsupported neutral options, owner-question support, streaming support, and readiness or sandbox preflight data.
created_at: 2026-05-17T08:54:03.000Z
updated_at: 2026-05-17T08:54:03.000Z
---

## Problem

`kota harness-parity run` captures prompt, trace, diff, verification, tokens,
turns, and cost for every registered harness, but it does not record the
adapter capability boundary that makes those results comparable. A KOTA-hosted
tool-loop harness and a native CLI harness can both fail or pass the same
coding scenario while relying on very different control surfaces: KOTA
guardrails, native sandbox flags, supported or rejected neutral options,
owner-question availability, streamed message support, and local auth/runtime
readiness.

Recent native-CLI and mini-SWE-agent signals reinforce the same lesson: coding
agent evidence is only useful when the command substrate and guardrail boundary
are explicit. KOTA already models this in `AgentHarness`, but the parity
artifacts hide it from the operator.

## Desired Outcome

Harness-parity artifacts make the adapter boundary first-class. Every
per-harness `run-meta.json`, `trace-summary.md`, and top-level `parity.json`
records enough static and local-readiness capability data for an operator to
interpret a result without reading adapter source. Comparing `claude-agent-sdk`,
`codex`, `gemini`, `gemini-cli`, `openai-tools`, `vercel`, or `thin` should
show whether the harness is KOTA-tool-controlled or native, which neutral
options are unsupported, whether owner questions and message streaming are
available, and what local runtime/auth/sandbox preflight facts were observed.

## Constraints

- Reuse the existing `AgentHarness` declaration and optional readiness
  surfaces. Do not add a second capability matrix or a hand-written
  harness-name catalog.
- Keep readiness local and non-networked. Artifact capture must not make
  provider calls before the scenario run.
- Treat unsupported options as protocol facts, not prose. Preserve option ids,
  run-option ids, and reasons in structured JSON.
- Do not hide native CLI harnesses or mark them inherently bad. The artifact
  should expose the boundary so a failed or passed result is interpreted
  honestly.
- Keep the current scenario execution path intact: `runScenarioOnHarness`
  still calls `runAgentHarness`, materializes the same working directories,
  and verifies with the scenario command.
- Avoid cost or latency ranking. This task is about capability and guardrail
  interpretation, not benchmarking.

## Done When

- A shared helper builds a typed harness capability snapshot from an
  `AgentHarness`, including at least `toolControl`, `supportsMultiTurn`,
  `askOwnerToolName`, `emitsAgentMessageStream`, `supportedHookKinds`,
  `unsupportedRunOptions`, and optional local readiness data when the harness
  exposes it.
- `run-meta.json` includes that snapshot for every harness run.
- `trace-summary.md` renders the same facts in a concise operator-readable
  section before streamed text.
- Top-level `parity.json` includes a compact capability summary per harness so
  side-by-side comparison does not require opening every child directory.
- Tests cover both a KOTA-tool-controlled harness and a native harness with
  unsupported tool-control options, proving the snapshot is structured and
  stable without live provider auth.
- The harness-parity module `AGENTS.md` stays aligned with the artifact shape
  after the new capability section lands.

## Source / Intent

Explorer run `2026-05-17T08-51-00-017Z-explorer-jujla2` found no actionable
ready, doing, or backlog work. The strategic blocked alternatives were all
operator-capture gated and non-movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The external signal came from refreshing the SWE-agent watchlist entry and
following its current mini-SWE-agent pointer. mini-SWE-agent emphasizes a small
coding-agent substrate where every action is an independent command. KOTA does
not need another agent framework for that, but it does need parity evidence
that names the substrate and guardrail boundary already modeled by
`AgentHarness`.

Relevant local evidence:

- `src/core/agent-harness/AGENTS.md` defines `toolControl: "kota" | "native"`
  and the unsupported-option contract.
- `src/modules/codex-agent-harness/AGENTS.md` and
  `src/modules/gemini-cli-agent-harness/AGENTS.md` document native CLI
  guardrail boundaries.
- `src/modules/harness-parity/runner.ts` currently writes outcome artifacts
  without those capability facts.

## Initiative

Harness-preset migration: make parity evidence explain which runtime substrate
and guardrail boundary produced each result.

## Acceptance Evidence

- `pnpm test src/modules/harness-parity/runner.test.ts` shows capability
  snapshots in `run-meta.json`, `trace-summary.md`, and `parity.json` for
  both KOTA-controlled and native-style fake harnesses.
- A `kota harness-parity run --scenario fix-arithmetic-bug --harness <name>`
  transcript or fixture shows the new capability section in the emitted
  artifacts without requiring live provider credentials.
