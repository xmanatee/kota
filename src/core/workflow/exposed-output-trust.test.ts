import { describe, expect, it } from "vitest";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "#core/workflow/validation.js";

function definition(exposeOutputToAgent?: boolean) {
  return registerWorkflowDefinition("test/explorer.ts", {
    repository: "read",
    name: "explorer",
    triggers: [{ event: "runtime.idle" }],
    steps: [
      {
        id: "claim-task",
        type: "code",
        ...(exposeOutputToAgent === undefined ? {} : { exposeOutputToAgent }),
        exposedOutputTrust: "untrusted",
        run: () => ({ chosenTaskId: "task-demo" }),
      },
    ],
  });
}

describe("workflow exposed output trust validation", () => {
  it("preserves untrusted provenance on agent-exposed output", () => {
    const [validated] = validateWorkflowDefinitions(
      [definition(true)],
      process.cwd(),
    );

    expect(validated?.steps[0]).toMatchObject({
      exposeOutputToAgent: true,
      exposedOutputTrust: "untrusted",
    });
  });

  it("rejects untrusted provenance without agent exposure", () => {
    expect(() =>
      validateWorkflowDefinitions([definition()], process.cwd()),
    ).toThrow(WorkflowDefinitionError);
    expect(() =>
      validateWorkflowDefinitions([definition()], process.cwd()),
    ).toThrow(/requires exposeOutputToAgent: true/);
  });
});
