import { describe, expect, it } from "vitest";
import {
  buildKotaAgentCommandTrace,
  kotaAgentCommandTraceMatches,
} from "#core/agent-harness/index.js";
import {
  projectKotaAgentMessageForStorage,
  projectWorkflowStepResultForStorage,
} from "./run-evidence.js";
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
      },
      usage: {
        tokens: { state: "complete", inputTokens: 12, outputTokens: 34 },
        cost: { state: "complete", usd: 0.01 },
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
    });
    expect(projected.usage).toEqual(result.usage);
    expect(JSON.stringify(projected)).not.toContain("raw-token");
  });

  it("retains command fingerprints while redacting provider status output", () => {
    const commandTrace = buildKotaAgentCommandTrace(
      "git commit -m secret=raw-token",
    );
    const projected = projectKotaAgentMessageForStorage({
      type: "status",
      category: "tool",
      toolName: "run_command",
      commandTrace,
      output: [JSON.stringify({ command: "git commit -m secret=raw-token" })],
    });

    expect(projected.output).toEqual([
      expect.stringContaining('"reason":"provider-payload"'),
    ]);
    expect(JSON.stringify(projected)).not.toContain("raw-token");
    expect(
      kotaAgentCommandTraceMatches(commandTrace, "git commit", "prefix"),
    ).toBe(true);
    expect(projected.commandTrace).toEqual(commandTrace);
  });
});
