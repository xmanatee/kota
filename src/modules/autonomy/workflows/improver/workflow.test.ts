import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import improverWorkflow, { IMPROVER_COOLDOWN_MS } from "./workflow.js";

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

describe("improver workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("event-driven triggers have cooldowns to prevent no-op churn", () => {
    const eventTriggers = improverWorkflow.triggers.filter(
      (t) => t.event !== "runtime.recovered",
    );
    for (const trigger of eventTriggers) {
      expect(trigger.cooldownMs, `${trigger.event} should have a cooldown`).toBe(
        IMPROVER_COOLDOWN_MS,
      );
    }
    // runtime.recovered should fire immediately without cooldown
    const recoveredTrigger = improverWorkflow.triggers.find(
      (t) => t.event === "runtime.recovered",
    );
    expect(recoveredTrigger?.cooldownMs).toBeUndefined();
  });

  it("skips commit and request-restart when improve fails", async () => {
    // No mock provided for improve → harness fails the agent step
    const harness = new WorkflowTestHarness(improverWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {},
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.improve.status).toBe("failed");
    expect(result.steps.commit).toBeUndefined();
    expect(result.steps["request-restart"]).toBeUndefined();
  });

  it("runs request-restart when improve succeeds and commit commits", async () => {
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(improverWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.improve.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("success");
  });

  it("skips request-restart when improve succeeds but nothing was committed", async () => {
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: false } as never);

    const harness = new WorkflowTestHarness(improverWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.improve.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });
});
