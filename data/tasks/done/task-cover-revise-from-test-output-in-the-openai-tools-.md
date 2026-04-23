---
id: task-cover-revise-from-test-output-in-the-openai-tools-
title: Cover revise-from-test-output in the openai-tools scenario-loop integration test
status: done
priority: p2
area: architecture
summary: Add a stubbed multi-turn integration test that drives the openai-tools harness through the revise-from-test-output scenario so tool-result fidelity regressions in the hand-composed tool_result path are caught locally, not only in an operator-facilitated live capture.
created_at: 2026-04-23T14:15:21.574Z
updated_at: 2026-04-23T20:23:09.438Z
---

## Problem

The `harness-parity` module ships three scenarios whose coverage points are
documented in `src/modules/harness-parity/AGENTS.md`. One of them —
`revise-from-test-output` — was added specifically to probe tool-result
fidelity across turns: the expected value only appears inside the
verification failure output, so "a harness that silently truncates, drops, or
fails to carry tool-result bytes back into the agent's next turn cannot clear
it".

The `openai-tools` harness is the harness most at risk of that class of
regression because its adapter hand-composes `tool_result` blocks in
`src/modules/openai-tools-agent-harness/adapter.ts` rather than delegating to
an SDK. Its only scenario-level integration test
(`scenario-loop.integration.test.ts`) exercises `extract-shared-helper`,
which is a multi-file write workload. A regression that dropped or mangled
the `content` field of a `tool_result` block would not be caught by the
existing tests; it would surface only in an operator-facilitated live
capture, which is blocked by
`task-capture-an-end-to-end-coding-task-parity-artifact-`.

## Desired Outcome

A stubbed integration test drives the `openai-tools` harness end-to-end
through the `revise-from-test-output` scenario. The stubbed model returns
tool-use calls that run the verification command through the tool registry,
and the harness's own tool-result composition carries the failure-output
bytes into the next model turn so the stubbed "next turn" can branch on that
content and produce a successful revise. A regression that silently
truncates or drops `tool_result` content fails this test.

## Constraints

- Reuse the existing stubbed-loop pattern from
  `openai-tools-agent-harness/scenario-loop.integration.test.ts` — same
  `vi.mock` seams for `createModelClient`, `executeTool`, `getAllTools`.
- Load the scenario via `loadScenario` from `#modules/harness-parity/scenario.js`;
  do not fork or inline the scenario spec.
- Materialize the scenario's `initial/` tree into a fresh `tmpdir`; never
  mutate the committed fixture. Clean up in `afterEach`.
- The stubbed model's "revise" turn must read the expected value out of the
  previous `tool_result` content rather than encoding it as a constant in
  the test — otherwise the test would pass even if tool-result fidelity
  broke. Assert that the value flowed through the harness's message history.
- No live API calls and no dependency on real provider credentials.
- Do not add a parallel scenario runner — the existing scenario loader is
  the one source of truth.

## Done When

- A new test case in `src/modules/openai-tools-agent-harness/scenario-loop.integration.test.ts`
  (or a co-located sibling file) exercises `revise-from-test-output` end-to-end
  under the `openai-tools` harness.
- The test asserts verification passes against the materialized tmpdir after
  the stubbed loop completes, and asserts the failure-output tail is present
  in the harness's composed `tool_result` content for the next turn.
- `pnpm test` passes locally with the new case active.
- A deliberate regression in the adapter's `tool_result.content` assembly
  (e.g. replacing the failure body with an empty string) causes the new
  test to fail, confirming the test is load-bearing.

