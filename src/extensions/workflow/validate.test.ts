import { describe, expect, it } from "vitest";
import { validateDefinitions } from "./validate.js";

const VALID_DEF = {
  name: "test-workflow",
  definitionPath: "src/workflows/test/workflow.ts",
  triggers: [{ event: "runtime.idle" }],
  steps: [{ type: "emit" as const, id: "done", event: "test.done" }],
};

const INVALID_DEF = {
  name: "",
  definitionPath: "src/workflows/bad/workflow.ts",
  triggers: [{ event: "runtime.idle" }],
  steps: [{ type: "emit" as const, id: "done", event: "test.done" }],
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
    const results = validateDefinitions([VALID_DEF, INVALID_DEF], "test-workflow");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("test-workflow");
    expect(results[0].valid).toBe(true);
  });

  it("throws for unknown --workflow name", () => {
    expect(() => validateDefinitions([VALID_DEF], "nonexistent")).toThrow("Unknown workflow");
  });
});
