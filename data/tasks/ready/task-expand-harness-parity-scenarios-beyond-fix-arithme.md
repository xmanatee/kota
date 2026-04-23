---
id: task-expand-harness-parity-scenarios-beyond-fix-arithme
title: Expand harness-parity scenarios beyond fix-arithmetic-bug to probe real coding workloads
status: ready
priority: p2
area: architecture
summary: Add at least one multi-file multi-turn coding scenario to src/modules/harness-parity/scenarios/ with deterministic shell verification, so harness parity evidence covers more than a 3-line single-file edit and the openai-tools adapter is exercised against a realistic tool-loop coding task.
created_at: 2026-04-23T00:28:36.141Z
updated_at: 2026-04-23T00:28:36.141Z
---

## Problem

`src/modules/harness-parity/scenarios/` ships exactly one scenario today,
`fix-arithmetic-bug`: a single-file three-line edit (change `a - b` to
`a + b` in `src/add.js`) verified by `node test.js`. The scenario was the
right shape for the parity-plumbing smoke proof, but it does not exercise
the capability the harness-parity claim is supposed to evidence.

A capable coding harness should distinguish itself from a text-only one
by:

- Reading more than one file before editing.
- Running and interpreting test output across more than one turn.
- Locating the change point through search rather than being told the path.

The current scenario passes after a single tool call to write a
three-character diff. Both `claude-agent-sdk` and the just-shipped
`openai-tools` adapter clear it with one round trip, so parity evidence
collapses to "both can run a tool". The "general-purpose coding agent
across pluggable harnesses" claim — and the openai-tools adapter's
`supportsMultiTurn: true` declaration — therefore have weak evidence
under the parity surface that exists to prove them.

The blocked task `task-capture-an-end-to-end-coding-task-parity-artifact-`
already names this gap from the operator side: when an operator finally
runs `kota harness-parity run` on authorized hardware, a single trivial
fixture produces a thin paired artifact. Strengthening the scenario set
makes that operator capture meaningful when it lands, without itself
requiring live API budget.

## Desired Outcome

`src/modules/harness-parity/scenarios/` ships at least one new scenario
that requires multi-turn editing across multiple files, deterministic
shell verification, and behavior the `thin` adapter cannot complete (so
the capability-gap path stays exercised). The scenario follows the
existing `scenario.json` + `initial/` shape — no new schema, no new
runner, no parallel benchmarking framework. The `openai-tools` adapter's
integration test set demonstrates the new scenario's shape resolves
through the harness registry and runs without protocol errors against a
stubbed tool-loop. The scenarios pack documentation in
`src/modules/harness-parity/AGENTS.md` notes the coverage range
(arithmetic-fix smoke vs. multi-file workload) at conventions level.

## Constraints

- Do not add a parallel scenario schema. Use the existing
  `scenario.json` shape (`id`, `description`, `prompt`, `verification`)
  with an `initial/` subtree.
- Verification must be a deterministic shell command whose exit status
  is the pass/fail signal, exactly like `node test.js` in the existing
  scenario. No subjective predicates.
- The new scenario must require reading at least two distinct files in
  the `initial/` tree and editing at least two of them — or editing one
  file whose correct content can only be derived after reading at least
  one other. A scenario that collapses to a single-file edit is not
  acceptable; that is what the existing fixture covers.
- Pick a workload that the `thin` (text-only single-turn) adapter
  genuinely cannot complete. The capability-gap path in
  `src/modules/harness-parity/AGENTS.md` is load-bearing — the gap must
  be observable when the parity runner executes, not a coincidence of a
  too-small task.
- Do not require any non-stdlib runtime beyond Node.js to verify. The
  scenario must run in the same minimal `tmpdir` the existing scenario
  runs in, with no `pnpm install` step or external service.
- Do not introduce a new harness, registry change, or runner change.
  This task is scenario content plus tests, not protocol work.
- Do not commit live API artifacts. The blocked task
  `task-capture-an-end-to-end-coding-task-parity-artifact-` still owns
  the operator-facilitated live capture; this task ships infrastructure
  the operator capture will consume.

## Done When

- A second scenario directory ships under
  `src/modules/harness-parity/scenarios/<id>/` with `scenario.json`
  plus an `initial/` tree. The id is descriptive (e.g.
  `extract-shared-helper`, `fix-failing-multi-file-test`,
  `wire-new-export`) — not `scenario-2`.
- The scenario meets the multi-file / multi-turn constraint above and
  is provably solvable by hand against the predicate (operator should
  be able to apply the fix manually and watch verification pass).
- Either `src/modules/harness-parity/scenario.test.ts` or a new
  co-located test verifies the scenario loads through the existing
  loader, its prompt and verification command resolve, and its
  `initial/` tree materializes into a fresh `tmpdir` without error.
- The `openai-tools` adapter's `adapter.integration.test.ts` (or a
  sibling test) exercises the new scenario's prompt shape against a
  stubbed tool-loop, demonstrating that a multi-turn loop can read
  files, execute the verification command, and reach `end_turn`. The
  test must not depend on a real model endpoint.
- `src/modules/harness-parity/AGENTS.md` documents the scenario set's
  coverage range — what each scenario probes, why both exist — at the
  conventions level, without enumerating every fixture file.
- No change to `runAgentHarness`, the harness registry, the parity
  runner, or any adapter implementation is required to land this. If
  one is, that work splits out as its own task before this one closes.
