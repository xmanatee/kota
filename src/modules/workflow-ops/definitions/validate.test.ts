import { describe, expect, it } from "vitest";
import { validateDefinitions } from "./validate.js";

const VALID_DEF = {
  name: "test-workflow",
  definitionPath: "src/modules/test/workflows/test/workflow.ts",
  triggers: [{ event: "runtime.idle" }],
  steps: [{ type: "emit" as const, id: "done", event: "test.done" }],
};

const INVALID_DEF = {
  name: "",
  definitionPath: "src/modules/test/workflows/bad/workflow.ts",
  triggers: [{ event: "runtime.idle" }],
  steps: [{ type: "emit" as const, id: "done", event: "test.done" }],
};

const AGENT_DEF = {
  name: "agent-workflow",
  definitionPath: "src/modules/test/workflows/agent/workflow.ts",
  moduleRoot: process.cwd(),
  triggers: [{ event: "runtime.idle" }],
  steps: [
    {
      type: "agent" as const,
      id: "agent",
      promptPath: "AGENTS.md",
      model: "claude-opus-4-7" as const,
      effort: "xhigh" as const,
      autonomyMode: "autonomous" as const,
    },
  ],
};

describe("validateDefinitions", () => {
  it("returns valid:true for a passing definition", () => {
    const results = validateDefinitions([VALID_DEF]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("test-workflow");
    expect(results[0].valid).toBe(true);
    expect(results[0].error).toBeUndefined();
  });

  it("returns valid:false with error for an invalid definition", () => {
    const results = validateDefinitions([INVALID_DEF]);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    expect(results[0].error).toBeTruthy();
  });

  it("reports each definition independently when mix of pass and fail", () => {
    const results = validateDefinitions([VALID_DEF, INVALID_DEF]);
    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });

  it("filters to a single workflow when --workflow is specified", () => {
    const results = validateDefinitions([VALID_DEF, INVALID_DEF], { workflow: "test-workflow" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("test-workflow");
    expect(results[0].valid).toBe(true);
  });

  it("throws for unknown --workflow name", () => {
    expect(() => validateDefinitions([VALID_DEF], { workflow: "nonexistent" })).toThrow("Unknown workflow");
  });

  it("passes defaultAgentHarness through to per-definition validation", () => {
    const results = validateDefinitions([AGENT_DEF], { defaultAgentHarness: "claude-agent-sdk" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "agent-workflow",
      valid: true,
      scope: "definition",
    });
  });

  it("reports global validation failures that isolated definitions cannot catch", () => {
    const dupA = { ...VALID_DEF, name: "duplicate-workflow" };
    const dupB = {
      ...VALID_DEF,
      definitionPath: "src/modules/test/workflows/duplicate-b/workflow.ts",
      name: "duplicate-workflow",
    };
    const results = validateDefinitions([dupA, dupB]);
    expect(results[0]).toMatchObject({
      name: "<global>",
      valid: false,
      scope: "global",
    });
    expect(results[0].error).toContain('duplicate workflow name "duplicate-workflow"');
  });
});
