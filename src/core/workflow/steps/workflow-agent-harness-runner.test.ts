import { describe, expect, it } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { createAgentRunLimiter } from "./agent-run-limiter.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("workflow agent harness runner", () => {
  it("shares the workflow agent limiter across nested harness calls", async () => {
    let active = 0;
    let invocations = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const harness: AgentHarness = {
      name: "nested-capacity-fixture",
      description: "Nested capacity fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async () => {
        const invocation = ++invocations;
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (invocation === 1) await firstReleased;
          return {
            text: "done",
            streamedText: "done",
            turns: 1,
            isError: false,
          };
        } finally {
          active--;
        }
      },
    };
    const runAgentHarness = createWorkflowAgentHarnessRunner(
      createAgentRunLimiter(1),
    );
    const options = {
      prompt: "review",
      model: "fixture-model",
      cwd: "/project",
      effort: "low" as const,
    };

    const first = runAgentHarness(harness, options);
    while (invocations === 0) await wait(1);
    const second = runAgentHarness(harness, options);
    try {
      await wait(20);
      expect(invocations).toBe(1);
    } finally {
      releaseFirst();
    }
    await Promise.all([first, second]);
    expect(invocations).toBe(2);
    expect(maxActive).toBe(1);
  });
});
