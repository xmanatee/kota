import { describe, expect, it } from "vitest";
import {
  labeledPredicate,
  type WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { WorkflowTestHarness } from "./index.js";

function skipReasonOf(step: { skipReason?: WorkflowStepSkipReason }): WorkflowStepSkipReason {
  if (!step.skipReason) {
    throw new Error("expected skipReason on skipped step");
  }
  return step.skipReason;
}

describe("WorkflowTestHarness — typed skip reasons", () => {
  it("tags a when-false leaf skip as when-predicate", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "leaf",
          type: "code",
          when: () => false,
          run: () => "unreachable",
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(result.steps.leaf.status).toBe("skipped");
    expect(skipReasonOf(result.steps.leaf)).toEqual({ kind: "when-predicate" });
  });

  it("carries a predicate's skipLabel through the when-predicate reason", async () => {
    const gated = labeledPredicate("recovery-trigger-gate", () => false);
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        { id: "leaf", type: "code", when: gated, run: () => "unreachable" },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(skipReasonOf(result.steps.leaf)).toEqual({
      kind: "when-predicate",
      label: "recovery-trigger-gate",
    });
  });

  it("tags branch-arm children as branch-arm-not-taken", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "decide",
          type: "branch",
          condition: () => true,
          ifTrue: [{ id: "taken", type: "code", run: () => "ok" }],
          ifFalse: [
            { id: "other", type: "code", run: () => "unreachable" },
          ],
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(result.steps.other.status).toBe("skipped");
    expect(skipReasonOf(result.steps.other)).toEqual({
      kind: "branch-arm-not-taken",
    });
    expect(result.steps.taken.status).toBe("success");
  });

  it("tags parallel child when-predicate skips on the child", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "group",
          type: "parallel",
          steps: [
            { id: "a", type: "code", run: () => "a-ok" },
            {
              id: "b",
              type: "code",
              when: () => false,
              run: () => "unreachable",
            },
          ],
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(result.steps.b.status).toBe("skipped");
    expect(skipReasonOf(result.steps.b)).toEqual({ kind: "when-predicate" });
    expect(result.steps.a.status).toBe("success");
  });

  it("tags foreach inner templates as foreach-empty when items is empty", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [],
          as: "x",
          steps: [{ id: "inner", type: "code", run: () => "unreachable" }],
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(result.steps.inner.status).toBe("skipped");
    expect(skipReasonOf(result.steps.inner)).toEqual({ kind: "foreach-empty" });
  });

  it("tags children of a when-skipped parallel group as parent-skipped", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "group",
          type: "parallel",
          when: () => false,
          steps: [
            { id: "child", type: "code", run: () => "unreachable" },
          ],
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();
    expect(result.steps.group.status).toBe("skipped");
    expect(skipReasonOf(result.steps.group)).toEqual({ kind: "when-predicate" });
    expect(result.steps.child.status).toBe("skipped");
    expect(skipReasonOf(result.steps.child)).toEqual({ kind: "parent-skipped" });
  });
});
