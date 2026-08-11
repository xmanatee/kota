import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import { runBuilderHarnessPreflight } from "./builder-harness-preflight.js";
import builderWorkflow from "./workflow.js";
import {
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder workflow harness preflight", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("fails harness readiness before claiming task work", async () => {
    const snapshot = makeSnapshot(1, 0);
    const projectDir = makeWorkflowProject(snapshot);
    vi.mocked(runBuilderHarnessPreflight).mockImplementationOnce(() => {
      throw new Error("unattended authentication cannot be verified");
    });
    const { claimNextQueueTask } = await import(
      "#modules/autonomy/task-claims.js"
    );

    const result = await new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.queue.available",
        payload: { actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps["preflight-builder-harness"]).toMatchObject({
      status: "failed",
      error: "unattended authentication cannot be verified",
    });
    expect(result.steps["claim-task"]).toBeUndefined();
    expect(claimNextQueueTask).not.toHaveBeenCalled();
  });
});
