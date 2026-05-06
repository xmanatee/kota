import { describe, expect, it } from "vitest";
import { buildWorkflowSnapshot } from "./run-store-snapshot.js";
import type { WorkflowDefinition } from "./types.js";

const baseWorkflow: WorkflowDefinition = {
  name: "builder",
  description: "Autonomous improvement workflow",
  enabled: true,
  recoveryCapable: false,
  tags: [],
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 30000 }],
  steps: [],
};

describe("buildWorkflowSnapshot", () => {
  it("maps top-level fields", () => {
    const snap = buildWorkflowSnapshot(baseWorkflow);
    expect(snap.name).toBe("builder");
    expect(snap.description).toBe("Autonomous improvement workflow");
    expect(snap.enabled).toBe(true);
    expect(snap.definitionPath).toBe("src/modules/autonomy/workflows/builder/workflow.ts");
    expect(snap.triggers).toEqual(baseWorkflow.triggers);
    expect(snap.steps).toEqual([]);
  });

  it("includes workflow defaultAutonomyMode when present", () => {
    const snap = buildWorkflowSnapshot({
      ...baseWorkflow,
      defaultAutonomyMode: "autonomous",
    });
    expect(snap.defaultAutonomyMode).toBe("autonomous");
  });

  it("omits description when not present", () => {
    const { description: _, ...wf } = baseWorkflow;
    const snap = buildWorkflowSnapshot(wf as WorkflowDefinition);
    expect(snap.description).toBeUndefined();
  });

  it("summarizes tool steps", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ id: "s1", type: "tool", tool: "Bash" }],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps).toEqual([{ id: "s1", type: "tool", tool: "Bash" }]);
  });

  it("summarizes agent steps", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [
        {
          id: "s1",
          type: "agent",
          promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
          harness: "claude-agent-sdk",
          moduleRoot: "/test-module-root",
          model: "claude-opus-4-7",
          effort: "xhigh",
          autonomyMode: "autonomous",
        },
      ],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps[0]).toMatchObject({
      id: "s1",
      type: "agent",
      promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
      autonomyMode: "autonomous",
    });
  });

  it("summarizes emit steps", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ id: "s1", type: "emit", event: "workflow.done" }],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps[0]).toEqual({ id: "s1", type: "emit", event: "workflow.done" });
  });

  it("summarizes restart steps", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ id: "s1", type: "restart", requires: ["s0"] }],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps[0]).toEqual({ id: "s1", type: "restart", requires: ["s0"] });
  });

  it("summarizes code steps with fallback", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ id: "s1", type: "code", run: async () => {} }],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps[0]).toEqual({ id: "s1", type: "code" });
  });

  it("includes exposeOutputToAgent when set", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ id: "s1", type: "code", run: async () => ({}), exposeOutputToAgent: true }],
    };
    const snap = buildWorkflowSnapshot(wf);
    expect(snap.steps[0]).toEqual({ id: "s1", type: "code", exposeOutputToAgent: true });
  });
});
