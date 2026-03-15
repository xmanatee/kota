import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockArchitectPass, mockEditorLoop } = vi.hoisted(() => ({
  mockArchitectPass: vi.fn(),
  mockEditorLoop: vi.fn(),
}));

vi.mock("./architect.js", () => ({
  runArchitectPass: mockArchitectPass,
  runEditorLoop: mockEditorLoop,
}));

import {
  runArchitectStep,
  type ArchitectStepConfig,
} from "./architect-runner.js";

function makeConfig(
  overrides: Partial<ArchitectStepConfig> = {},
): ArchitectStepConfig {
  return {
    client: {} as never,
    model: "claude-test",
    editorModel: "claude-editor",
    maxTokens: 4096,
    effectiveMaxTokens: 2048,
    systemContext: "Test context",
    messages: [{ role: "user", content: "Refactor auth" }],
    costTracker: { add: vi.fn() } as never,
    verbose: false,
    ...overrides,
  };
}

describe("runArchitectStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null and skips editor when architect produces no plan", async () => {
    mockArchitectPass.mockResolvedValue(null);
    const result = await runArchitectStep(makeConfig());
    expect(result).toBeNull();
    expect(mockEditorLoop).not.toHaveBeenCalled();
  });

  it("passes effectiveMaxTokens to architect pass", async () => {
    mockArchitectPass.mockResolvedValue(null);
    await runArchitectStep(
      makeConfig({ maxTokens: 4096, effectiveMaxTokens: 2048 }),
    );
    expect(mockArchitectPass).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 2048 }),
    );
  });

  it("passes maxTokens and editorModel to editor loop", async () => {
    mockArchitectPass.mockResolvedValue("Plan");
    mockEditorLoop.mockResolvedValue("Done");
    await runArchitectStep(
      makeConfig({
        model: "architect-m",
        editorModel: "editor-m",
        maxTokens: 4096,
        effectiveMaxTokens: 2048,
      }),
    );
    expect(mockEditorLoop).toHaveBeenCalledWith(
      expect.objectContaining({ model: "editor-m", maxTokens: 4096 }),
    );
  });

  it("uses editor result as lastResult when available", async () => {
    mockArchitectPass.mockResolvedValue("Plan");
    mockEditorLoop.mockResolvedValue("Editor output");
    const result = await runArchitectStep(makeConfig());
    expect(result!.lastResult).toBe("Editor output");
  });

  it("falls back to plan when editor returns empty", async () => {
    mockArchitectPass.mockResolvedValue("The plan");
    mockEditorLoop.mockResolvedValue("");
    const result = await runArchitectStep(makeConfig());
    expect(result!.lastResult).toBe("The plan");
  });

  it("truncates plan to 500 chars in summary", async () => {
    const longPlan = "A".repeat(600);
    mockArchitectPass.mockResolvedValue(longPlan);
    mockEditorLoop.mockResolvedValue("Done");
    const result = await runArchitectStep(makeConfig());
    expect(result!.summary).toContain("A".repeat(500));
    expect(result!.summary).not.toContain("A".repeat(501));
  });

  it("includes editor result in summary when present, omits when absent", async () => {
    mockArchitectPass.mockResolvedValue("Plan");
    mockEditorLoop.mockResolvedValue("Completed refactoring");
    const withEditor = await runArchitectStep(makeConfig());
    expect(withEditor!.summary).toContain(
      "Editor result: Completed refactoring",
    );

    vi.clearAllMocks();
    mockArchitectPass.mockResolvedValue("Plan");
    mockEditorLoop.mockResolvedValue(null);
    const withoutEditor = await runArchitectStep(makeConfig());
    expect(withoutEditor!.summary).not.toContain("Editor result:");
  });
});
