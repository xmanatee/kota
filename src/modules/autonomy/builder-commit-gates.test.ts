import { describe, expect, it } from "vitest";
import { makeWorkflowStepContext } from "./commit-test-support.js";
import builderWorkflow from "./workflows/builder/workflow.js";

describe("builder workflow commit and restart gates", () => {
  const buildStep = builderWorkflow.steps.find((s) => s.id === "build");
  const commitStep = builderWorkflow.steps.find((s) => s.id === "commit");
  const restartStep = builderWorkflow.steps.find((s) => s.id === "request-restart");

  it("governs builder runtime by progress rather than an absolute deadline", () => {
    expect(buildStep).toMatchObject({
      type: "agent",
      timeoutMs: null,
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

  it("skips commit until the claimed-task consistency check passes", async () => {
    const ctx = makeWorkflowStepContext({
      build: "success",
      "create-task-branch": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("runs commit when build and claimed-task consistency pass", async () => {
    const ctx = makeWorkflowStepContext({
      build: "success",
      "create-task-branch": "success",
      "check-claimed-task-consistency": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(true);
  });

  it("skips restart when commit produced no commit", async () => {
    const ctx = makeWorkflowStepContext(
      { commit: "success" },
      {
        commit: {
          committed: false,
          committedPaths: [],
          daemonRestartRequired: false,
        },
      },
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
          committedPaths: ["src/change.ts"],
          daemonRestartRequired: true,
        },
        "check-claimed-task-consistency": {
          matched: true,
          taskId: "task-claimed",
          claimedTaskId: "task-claimed",
          completedTaskId: "task-claimed",
        },
      },
    );
    expect(await restartStep!.when!(ctx)).toBe(true);
  });

  it("skips restart for a task-state-only builder commit", async () => {
    const ctx = makeWorkflowStepContext(
      { commit: "success", "check-claimed-task-consistency": "success" },
      {
        commit: {
          committed: true,
          message: "Builder: close task",
          sha: "0000000000000000000000000000000000000000",
          committedPaths: ["data/tasks/done/task-claimed.md"],
          daemonRestartRequired: false,
        },
        "check-claimed-task-consistency": {
          matched: true,
          taskId: "task-claimed",
          claimedTaskId: "task-claimed",
          completedTaskId: "task-claimed",
        },
      },
    );

    expect(await restartStep!.when!(ctx)).toBe(false);
  });
});
