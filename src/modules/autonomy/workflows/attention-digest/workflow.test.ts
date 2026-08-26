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
});
