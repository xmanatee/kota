import { describe, expect, it } from "vitest";
import decomposerWorkflow from "./workflow.js";

describe("decomposer exposed output trust", () => {
  it("marks the task snapshot and typed plan as separate untrusted agent inputs", () => {
    const assessmentStep = decomposerWorkflow.steps.find(
      (candidate) => candidate.id === "assess-failure",
    );
    const planStep = decomposerWorkflow.steps.find(
      (candidate) => candidate.id === "decompose",
    );

    expect(assessmentStep).toMatchObject({
      type: "code",
      exposeOutputToAgent: true,
      exposedOutputTrust: "untrusted",
    });
    expect(planStep).toMatchObject({
      type: "agent",
      exposeOutputToAgent: true,
      exposedOutputTrust: "untrusted",
    });
  });
});
