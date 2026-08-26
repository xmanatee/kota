import { describe, expect, it } from "vitest";
import { parseWorkflowRunMetadata } from "./run-metadata.js";

function metadataWithAgentStep(usage: unknown) {
  return {
    id: "run-1",
    workflow: "builder",
    definitionPath: "workflow.ts",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    startedAt: "2026-08-26T00:00:00.000Z",
    status: "success",
    runDir: ".kota/runs/run-1",
    steps: [{
      id: "build",
      type: "agent",
      status: "success",
      startedAt: "2026-08-26T00:00:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z",
      durationMs: 60_000,
      ...(usage === undefined ? {} : { usage }),
    }],
  };
}

describe("parseWorkflowRunMetadata", () => {
  it("accepts canonical usage on a non-skipped agent step", () => {
    const metadata = parseWorkflowRunMetadata(metadataWithAgentStep({
      tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
      cost: { state: "unknown" },
    }));

    expect(metadata.steps[0]?.usage).toEqual({
      tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
      cost: { state: "unknown" },
    });
  });

  it("rejects missing or legacy agent-step usage", () => {
    expect(() => parseWorkflowRunMetadata(metadataWithAgentStep(undefined))).toThrow(
      "workflow run metadata.steps.0",
    );
    expect(() => parseWorkflowRunMetadata(metadataWithAgentStep({
      inputTokens: 100,
      outputTokens: 20,
      totalCostUsd: 0,
    }))).toThrow("workflow run metadata.steps.0");
  });

  it("permits skipped agent steps only without usage", () => {
    const raw = metadataWithAgentStep(undefined);
    raw.steps[0] = {
      ...raw.steps[0],
      status: "skipped",
      skipReason: { kind: "when-predicate" },
    } as typeof raw.steps[number];
    expect(parseWorkflowRunMetadata(raw).steps[0]?.status).toBe("skipped");

    raw.steps[0] = {
      ...raw.steps[0],
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
    };
    expect(() => parseWorkflowRunMetadata(raw)).toThrow("workflow run metadata.steps.0");
  });
});
