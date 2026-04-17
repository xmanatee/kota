import { describe, expect, it } from "vitest";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import attentionDigestWorkflow from "./workflow.js";

describe("attention-digest workflow definition", () => {
  it("registers without errors", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.name).toBe("attention-digest");
  });

  it("has a single code step named digest", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.steps).toHaveLength(1);
    expect(registered.steps[0].id).toBe("digest");
    expect(registered.steps[0].type).toBe("code");
  });
});
