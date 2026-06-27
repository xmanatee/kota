import { describe, expect, it } from "vitest";
import { makeWorkflowStepContext } from "./commit-test-support.js";
import builderWorkflow from "./workflows/builder/workflow.js";

describe("builder workflow commit and restart gates", () => {
  const buildStep = builderWorkflow.steps.find((s) => s.id === "build");
  const commitStep = builderWorkflow.steps.find((s) => s.id === "commit");
  const restartStep = builderWorkflow.steps.find((s) => s.id === "request-restart");

  it("gives the builder agent a long hard cap plus a separate progress idle cap", () => {
    expect(buildStep).toMatchObject({
      type: "agent",
      timeoutMs: 6 * 60 * 60 * 1000,
      idleTimeoutMs: 60 * 60 * 1000,
    });
  });

  it("commit step exists in the workflow", () => {
    expect(commitStep).toBeDefined();
    expect(commitStep?.when).toBeDefined();
  });

  it("restart step exists in the workflow", () => {
    expect(restartStep).toBeDefined();
    expect(restartStep?.when).toBeDefined();
  });

  it("skips commit when build fails", async () => {
    const ctx = makeWorkflowStepContext({
      build: "failed",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("runs commit when build passes", async () => {
    const ctx = makeWorkflowStepContext({
      build: "success",
      "create-task-branch": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(true);
  });

  it("skips restart when commit produced no commit", async () => {
    const ctx = makeWorkflowStepContext(
      { commit: "success" },
      { commit: { committed: false } },
    );
    expect(await restartStep!.when!(ctx)).toBe(false);
  });

  it("runs restart when commit produced a commit", async () => {
    const ctx = makeWorkflowStepContext(
      { commit: "success", "check-claimed-task-consistency": "success" },
      {
        commit: {
          committed: true,
          message: "Workflow: update repo",
          sha: "0000000000000000000000000000000000000000",
        },
        "check-claimed-task-consistency": {
          matched: true,
          taskId: "task-claimed",
          claimedTaskId: "task-claimed",
          summaryTaskId: "task-claimed",
        },
      },
    );
    expect(await restartStep!.when!(ctx)).toBe(true);
  });
});
