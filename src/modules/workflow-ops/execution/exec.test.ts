import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { overrideWorkflowAgentExecution } from "./exec.js";

describe("workflow exec agent execution override", () => {
  it("forces harness, model, and effort while removing tier routing", () => {
    const definition = {
      steps: [
        {
          id: "evaluate",
          type: "agent",
          harness: "claude-agent-sdk",
          model: "claude-old",
          tier: "capable",
          effort: "low",
        },
      ],
    } as WorkflowDefinition;

    const overridden = overrideWorkflowAgentExecution(definition, {
      harness: "antigravity-cli",
      model: "gemini-3.6-flash",
      effort: "max",
    });

    expect(overridden.steps[0]).toMatchObject({
      id: "evaluate",
      type: "agent",
      harness: "antigravity-cli",
      model: "gemini-3.6-flash",
      effort: "max",
    });
    expect(overridden.steps[0]).not.toHaveProperty("tier");
  });
});
