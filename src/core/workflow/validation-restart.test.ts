import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "./step-types.js";
import { validateRestartConstraints } from "./validation-restart.js";

const verify: WorkflowStep = {
  id: "verify",
  type: "code",
  run: () => "ok",
};

const handoff: WorkflowStep = {
  id: "handoff",
  type: "emit",
  event: "builder.done",
};

describe("restart workflow validation", () => {
  it("keeps restart final by default", () => {
    expect(() =>
      validateRestartConstraints(
        [
          verify,
          { id: "restart", type: "restart", requires: ["verify"] },
          handoff,
        ],
        "test/workflow.ts",
      )
    ).toThrow('restart step "restart" must be the final step');
  });

  it("allows an opted-in emit handoff after restart", () => {
    expect(() =>
      validateRestartConstraints(
        [
          verify,
          {
            id: "restart",
            type: "restart",
            requires: ["verify"],
            allowPostRestartEmits: true,
          },
          handoff,
        ],
        "test/workflow.ts",
      )
    ).not.toThrow();
  });

  it("rejects executable work after an opted-in restart", () => {
    expect(() =>
      validateRestartConstraints(
        [
          verify,
          {
            id: "restart",
            type: "restart",
            requires: ["verify"],
            allowPostRestartEmits: true,
          },
          { id: "after", type: "code", run: () => "too late" },
        ],
        "test/workflow.ts",
      )
    ).toThrow(
      'restart step "restart" may only be followed by emit steps, got "code" for "after"',
    );
  });
});
