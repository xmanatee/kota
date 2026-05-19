---
id: task-allow-bounded-concurrent-agent-foreach-iterations
title: Allow bounded concurrent agent foreach iterations
status: done
priority: p2
area: runtime
summary: Remove the stale foreach validation ban on agent inner steps with maxConcurrency > 1 and route those iterations through the existing agent concurrency back-pressure so dynamic batch-agent workflows stay inside the workflow DSL.
created_at: 2026-05-19T19:26:17Z
updated_at: 2026-05-19T19:39:43Z
---

## Problem

KOTA now has three pieces that should compose cleanly:

- `foreach` steps can iterate over dynamic item lists and can contain agent
  inner steps.
- `foreach.maxConcurrency` can process multiple item iterations at once.
- The runtime has global agent-step back-pressure through
  `scheduler.agentConcurrency` / `maxAgentRuns`, and parallel agent step groups
  already use that contract.

The remaining validation rule still rejects `maxConcurrency > 1` whenever a
foreach body contains an agent step, with the rationale that agent iterations
would contend for the agent concurrency slot. That rationale is stale now that
agent-step concurrency is a first-class runtime concern. It forces dynamic
batch-agent work back into fixed parallel groups, ad hoc code loops, or separate
workflow runs, which weakens observability and makes KOTA less capable than the
workflow model already allows.

## Desired Outcome

`foreach` supports bounded concurrent iterations whose inner body includes
agent steps. The implementation keeps foreach as the single typed mechanism for
dynamic batch-agent work: no new public job engine, no CSV-specific runtime
primitive, and no bypass around existing agent-step accounting.

When `maxConcurrency > 1`, each iteration may run concurrently up to the
foreach cap, while the existing runtime agent-concurrency back-pressure decides
how many agent inner steps are actually active. Results remain ordered by item
index, failures preserve current `continueOnFailure` behavior, and retry /
partial-resume behavior still reruns only failed or incomplete items.

## Constraints

- Remove the validation ban only after the executor path proves agent inner
  steps honor the same `maxAgentRuns` / `agentConcurrency` ceiling used by
  parallel agent groups.
- Do not add a second batch-agent abstraction. Reuse `foreach` items, inner
  agent steps, and existing step-result records.
- Keep item result ordering deterministic by original item index, not
  completion order.
- Preserve existing serial behavior when `maxConcurrency` is absent or `1`.
- Preserve the current rejection for unsupported nested step types inside a
  foreach body.
- Avoid cost- or speed-driven autonomy policy changes. This is a correctness
  and expressiveness fix for the runtime protocol.

## Done When

- Workflow validation accepts a foreach step with `maxConcurrency > 1` and an
  agent inner step.
- A runtime or executor test proves two or more foreach agent iterations can be
  scheduled concurrently when the agent-concurrency limit allows it.
- A companion test proves `agentConcurrency: 1` serializes the agent inner
  steps even when `foreach.maxConcurrency` is greater than one.
- Ordered output, `continueOnFailure`, retry, and partial-resume behavior remain
  covered for concurrent agent foreach runs.
- Existing code-only foreach concurrency tests still pass unchanged.

## Source / Intent

External signal: the OpenAI Codex CLI multi-agent workflow discussion
(`https://github.com/openai/codex/issues/12832`) documents a batch-agent job
pattern where a structured item list fans out to sub-agents under a concurrency
cap and collects item results. KOTA should not copy that as a new job engine;
the local equivalent is already the workflow DSL's `foreach` plus agent inner
steps. The gap is the stale validation rule preventing those existing pieces
from composing.

Local evidence:

- `data/tasks/done/task-workflow-foreach-step.md` made agent inner steps valid
  inside foreach.
- `data/tasks/done/task-foreach-step-concurrency.md` added
  `maxConcurrency`, but intentionally rejected agent bodies before agent
  back-pressure had matured.
- `data/tasks/done/task-parallel-agent-steps.md` later made concurrent agent
  step execution a runtime-backed contract.
- `src/core/workflow/step-validators/validate-foreach-step.ts` still contains
  the now-stale rejection.

## Initiative

Workflow runtime expressiveness: dynamic multi-agent work should stay
definition-driven, typed, observable in run artifacts, and governed by the same
agent-concurrency rails as every other workflow agent step.

## Acceptance Evidence

- `pnpm test src/core/workflow/steps/step-executor-foreach.test.ts`
- `pnpm test src/workflow-run-executor-parallel.integration.test.ts`
- Queue validation passes after this task moves to `done/`.

## Completion Evidence

- `pnpm test src/core/workflow/steps/step-executor-foreach.test.ts` — 27 passed.
- `pnpm test src/workflow-run-executor-parallel.integration.test.ts` — 11 passed.
- `pnpm test src/core/workflow/run-executor-utils.test.ts` — 5 passed.
- `pnpm test src/workflow-runtime.integration.test.ts` — 49 passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm validate-tasks` passed after the task move was staged.
