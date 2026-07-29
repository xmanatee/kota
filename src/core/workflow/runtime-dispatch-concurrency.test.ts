import { describe, expect, it } from "vitest";
import { canDispatchDefinition } from "./runtime-dispatch-concurrency.js";
import type { WorkflowDefinition } from "./types.js";

type DispatchState = Parameters<typeof canDispatchDefinition>[0];

function definition(name: string, concurrencyGroup?: string): WorkflowDefinition {
  return {
    name,
    enabled: true,
    moduleRoot: "/project",
    recoveryCapable: false,
    ...(concurrencyGroup ? { concurrencyGroup } : {}),
    tags: [],
    definitionPath: "fixture.ts",
    triggers: [],
    steps: [
      {
        id: "review",
        type: "agent",
        harness: "fixture",
        promptPath: "prompt.md",
        moduleRoot: "/project",
        model: "fixture-model",
        effort: "low",
        autonomyMode: "autonomous",
      },
    ],
  };
}

function state(
  definitions: WorkflowDefinition[],
  activeWorkflowName: string,
  agentConcurrency = 1,
): DispatchState {
  return {
    projectDir: "/project",
    definitions,
    activeRuns: new Map([
      [
        "active-run",
        {
          runId: "active-run",
          workflowName: activeWorkflowName,
          promise: new Promise<never>(() => {}),
          abortController: new AbortController(),
        },
      ],
    ]),
    agentConcurrency,
    codeConcurrency: 4,
  };
}

describe("workflow dispatch concurrency", () => {
  it("applies global agent capacity across named concurrency groups", () => {
    const builder = definition("builder");
    const progressReviewer = definition("progress-reviewer", "canonical-mutation");

    expect(
      canDispatchDefinition(
        state([builder, progressReviewer], builder.name),
        progressReviewer,
      ),
    ).toBe(false);
    expect(
      canDispatchDefinition(
        state([builder, progressReviewer], progressReviewer.name),
        builder,
      ),
    ).toBe(false);
    expect(
      canDispatchDefinition(
        state([builder, progressReviewer], builder.name, 2),
        progressReviewer,
      ),
    ).toBe(true);
  });
});
