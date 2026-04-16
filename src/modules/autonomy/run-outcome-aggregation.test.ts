import { describe, expect, it } from "vitest";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
  WorkflowStepStatus,
} from "#core/workflow/run-types.js";
import { tallyRepairFailures } from "./run-outcome-aggregation.js";

type Iter = { attempt: number; failures: Array<{ id: string }> };

function makeStep(
  id: string,
  status: WorkflowStepStatus,
  iterations: Iter[],
): WorkflowStepResult {
  return {
    id,
    type: "agent",
    status,
    startedAt: "2026-04-16T00:00:00.000Z",
    completedAt: "2026-04-16T00:00:01.000Z",
    durationMs: 1000,
    output: { repairIterations: iterations },
  };
}

function makeRun(steps: WorkflowStepResult[]): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: "2026-04-16T00:00:00.000Z",
    status: "success",
    runDir: "run-1",
    steps,
  };
}

describe("tallyRepairFailures", () => {
  it("counts a persistent check once per step, not once per iteration", () => {
    const run = makeRun([
      makeStep("build", "success", [
        { attempt: 1, failures: [{ id: "critic-review" }] },
        { attempt: 2, failures: [{ id: "critic-review" }] },
        { attempt: 3, failures: [{ id: "critic-review" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    expect(tally).toEqual([
      { checkId: "critic-review", count: 1, recovered: 1, terminal: 0 },
    ]);
  });

  it("labels failures in a successful step as recovered", () => {
    const run = makeRun([
      makeStep("build", "success", [
        { attempt: 1, failures: [{ id: "typecheck" }, { id: "lint" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    expect(tally).toEqual([
      { checkId: "typecheck", count: 1, recovered: 1, terminal: 0 },
      { checkId: "lint", count: 1, recovered: 1, terminal: 0 },
    ]);
  });

  it("labels a persistent failure in a failed step as terminal, never as recovered", () => {
    const run = makeRun([
      makeStep("build", "failed", [
        { attempt: 1, failures: [{ id: "typecheck" }, { id: "lint" }] },
        { attempt: 2, failures: [{ id: "typecheck" }, { id: "build-output" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    const byId = new Map(tally.map((t) => [t.checkId, t]));
    expect(byId.get("typecheck")).toEqual({
      checkId: "typecheck",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("build-output")).toEqual({
      checkId: "build-output",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("lint")).toEqual({
      checkId: "lint",
      count: 1,
      recovered: 1,
      terminal: 0,
    });
  });

  it("aggregates across runs and sorts by count descending", () => {
    const runs = [
      makeRun([
        makeStep("build", "success", [
          { attempt: 1, failures: [{ id: "critic-review" }] },
        ]),
      ]),
      makeRun([
        makeStep("build", "success", [
          { attempt: 1, failures: [{ id: "critic-review" }, { id: "typecheck" }] },
        ]),
      ]),
      makeRun([
        makeStep("build", "failed", [
          { attempt: 1, failures: [{ id: "critic-review" }] },
        ]),
      ]),
    ];
    const tally = tallyRepairFailures(runs);
    expect(tally[0]).toEqual({
      checkId: "critic-review",
      count: 3,
      recovered: 2,
      terminal: 1,
    });
    expect(tally[1]).toEqual({
      checkId: "typecheck",
      count: 1,
      recovered: 1,
      terminal: 0,
    });
  });

  it("ignores steps with no repair iterations", () => {
    const run = makeRun([
      {
        id: "plain",
        type: "agent",
        status: "success",
        startedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:01.000Z",
        durationMs: 1000,
        output: { content: "done" },
      },
    ]);
    expect(tallyRepairFailures([run])).toEqual([]);
  });
});
