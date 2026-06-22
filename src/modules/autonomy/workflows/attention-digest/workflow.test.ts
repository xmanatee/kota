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

  it("resets during recovery before running the digest step", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    );
    expect(registered.recoveryCapable).toBe(true);
    expect(registered.triggers.some((trigger) => trigger.event === "runtime.recovered")).toBe(true);
    expect(registered.steps.map((step) => step.id)).toEqual([
      "reset-for-recovery",
      "digest",
    ]);
    expect(registered.steps[0].type).toBe("code");
    expect(registered.steps[1].type).toBe("code");
  });
});
