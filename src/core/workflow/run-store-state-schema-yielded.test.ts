import { describe, expect, it } from "vitest";
import { assertWorkflowRunMetadata } from "./run-store-state-schema.js";

const metadata = {
  id: "run-yielded",
  workflow: "builder",
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "yielded",
  runDir: ".kota/runs/run-yielded",
  steps: [{
    id: "build",
    type: "agent",
    status: "yielded",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    durationMs: 60_000,
  }],
};

describe("yielded workflow run metadata", () => {
  it("accepts yielded run and step statuses", () => {
    expect(() => assertWorkflowRunMetadata("/metadata.json", metadata)).not.toThrow();
  });
});
