import { describe, expect, it } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { resolveWorkflowAgentRunContract } from "./step-executor-agent-run-contract.js";

describe("resolveWorkflowAgentRunContract", () => {
  it("routes the workflow output schema through the neutral harness contract", () => {
    const outputSchema = {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } },
    };
    const harness: AgentHarness = {
      name: "native-fixture",
      description: "native fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      run: async () => ({
        text: "",
        streamedText: "",
        turns: 0,
        isError: false,
      }),
    };

    const contract = resolveWorkflowAgentRunContract({
      step: {
        harness: harness.name,
        model: "fixture-model",
        effort: "high",
        autonomyMode: "autonomous",
        outputSchema,
      },
      harness,
      model: "fixture-model",
      prompt: "inspect",
      canUseTool: async (_toolName, input) => ({
        behavior: "allow",
        updatedInput: input,
      }),
      askOwnerSource: "test",
    });

    expect(contract.options.outputSchema).toBe(outputSchema);
  });
});
