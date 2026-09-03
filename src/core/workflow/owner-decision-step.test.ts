import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AwaitedOwnerDecisionOutcome } from "./owner-decision-step.js";
import {
  createOwnerDecisionWorkflowFixture,
  type OwnerDecisionWorkflowFixture,
} from "./owner-decision-step-test-fixture.js";

describe("owner decision workflow steps", () => {
  let fixture: OwnerDecisionWorkflowFixture;

  beforeEach(() => {
    fixture = createOwnerDecisionWorkflowFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it("persists a selected data-only decision after a suspended workflow resumes", async () => {
    const { promise } = fixture.execute(fixture.makeDataOnlyWorkflow());

    await fixture.answerPendingQuestion("module");
    const result = await promise;
    const outcome = result.metadata.steps.find((step) => step.id === "choose-consume")
      ?.output as AwaitedOwnerDecisionOutcome;

    expect(result.metadata.status).toBe("success");
    expect(outcome).toMatchObject({
      kind: "answered",
      selectedValue: { kind: "single-choice", optionId: "module" },
    });
    expect(outcome.kind === "answered" ? fixture.decisionStore.get(outcome.decisionId) : null)
      .toMatchObject({
        status: "answered",
        selectedValue: { kind: "single-choice", optionId: "module" },
      });
  });
});
