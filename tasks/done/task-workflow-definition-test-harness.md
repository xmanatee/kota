---
id: task-workflow-definition-test-harness
title: Add a lightweight test harness for workflow definitions
status: done
priority: p2
area: dx
summary: Extension authors and operators have no structured way to unit-test their workflow definitions. They must run a full daemon to verify step logic, trigger conditions, and predicate evaluation. A test harness that simulates step execution without a real agent would close this gap.
created_at: 2026-04-01T01:53:23Z
updated_at: 2026-04-01T01:53:23Z
---

## Problem

KOTA has a `kota workflow dry-run` command that previews step execution order and
evaluates `when` predicates, but it does not execute step logic. Extension authors
who write `code` steps or complex predicate functions have no way to verify their
logic in a unit test without spinning up a daemon, triggering a real run, and
reading the run output.

There is no public API in `kota/extension` for testing workflow behavior. Extension
authors end up either skipping tests entirely or writing brittle integration tests
that spawn real processes.

## Desired Outcome

A `WorkflowTestHarness` exported from `kota/extension` (or a `kota/testing`
sub-path) that lets authors write vitest or jest tests like:

```ts
import { WorkflowTestHarness } from "kota/testing";
import myWorkflow from "./workflow.js";

test("skips deploy step when no changes", async () => {
  const harness = new WorkflowTestHarness(myWorkflow, {
    trigger: { event: "runtime.idle", payload: {} },
    stepMocks: {
      "check-changes": { output: { changed: false } },
    },
  });
  const result = await harness.run();
  expect(result.steps["deploy"].status).toBe("skipped");
});
```

The harness:
- Executes code steps using real logic.
- Lets callers mock agent step outputs without running a real agent.
- Evaluates `when` predicates using the same runtime as production.
- Records step results, statuses, and skip reasons.
- Does not require a daemon, network, or filesystem state.

## Constraints

- The harness must not require a running daemon or real agent session.
- Code steps execute their actual `run` functions; the harness provides a mock
  `WorkflowStepContext` satisfying the full interface.
- Agent steps must be mockable via `stepMocks`; a missing mock for an agent step
  should throw a clear error (not silently skip).
- The harness exports should not expose internal KOTA types not already in the
  public extension API.
- Keep the implementation in a `src/workflow-testing/` directory or similar;
  build it into a `kota/testing` dist entry.
- Parallel group execution in the harness should run serially (for determinism),
  with an opt-in `parallel: true` flag.

## Done When

- `WorkflowTestHarness` is exported from a `kota/testing` sub-path import.
- Code steps run their real `run` function via a mock step context.
- Agent steps are interceptable via `stepMocks`; missing mocks throw.
- `when` predicates are evaluated with real predicate evaluation logic.
- Step results include status, output, skip reason, and (mocked) cost.
- At least two built-in workflow definitions (e.g. explorer or builder) have
  representative unit tests written using the harness.
- The harness is documented in `docs/WORKFLOWS.md` with a short example.
