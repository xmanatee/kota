import { describe, expect, it } from "vitest";
import { projectWorkflowStepResultForStorage } from "./run-evidence.js";
import type { WorkflowStepResult } from "./run-types.js";

describe("workflow run evidence projection", () => {
  it("redacts agent result content before durable step storage", () => {
    const result: WorkflowStepResult = {
      id: "build",
      type: "agent",
      status: "success",
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      durationMs: 1000,
      output: {
        content: "provider output with secret=raw-token",
        sessionId: "session-1",
        turns: 3,
        totalCostUsd: 0.01,
        inputTokens: 12,
        outputTokens: 34,
      },
    };

    const projected = projectWorkflowStepResultForStorage(result);

    expect(projected.output).toMatchObject({
      content: {
        redacted: true,
        reason: "provider-payload",
      },
      sessionId: "session-1",
      turns: 3,
      totalCostUsd: 0.01,
      inputTokens: 12,
      outputTokens: 34,
    });
    expect(JSON.stringify(projected)).not.toContain("raw-token");
  });
});
