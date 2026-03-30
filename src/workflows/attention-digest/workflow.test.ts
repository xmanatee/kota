import { describe, expect, it } from "vitest";
import { registerWorkflowDefinition } from "../../workflow/validation.js";
import attentionDigestWorkflow from "./workflow.js";

describe("attention-digest workflow definition", () => {
  it("registers without errors", () => {
    const registered = registerWorkflowDefinition(
      "src/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.name).toBe("attention-digest");
  });

  it("has a workflow.completed trigger filtered to explorer, builder, and improver", () => {
    const registered = registerWorkflowDefinition(
      "src/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.triggers).toHaveLength(1);
    expect(registered.triggers[0].event).toBe("workflow.completed");
    expect(registered.triggers[0].filter).toMatchObject({
      workflow: ["explorer", "builder", "improver"],
    });
  });

  it("has a single code step named digest", () => {
    const registered = registerWorkflowDefinition(
      "src/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.steps).toHaveLength(1);
    expect(registered.steps[0].id).toBe("digest");
    expect(registered.steps[0].type).toBe("code");
  });
});
