import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadProjectContext = vi.fn((_dir?: string) => "");
const mockLoadInstructionContext = vi.fn((_dir?: string) => "");
const mockBuildUserProfile = vi.fn((_cfg: unknown) => "");

vi.mock("../project-context.js", () => ({
  loadProjectContext: (dir?: string) => mockLoadProjectContext(dir),
}));

vi.mock("../instruction-files.js", () => ({
  loadInstructionContext: (dir?: string) => mockLoadInstructionContext(dir),
}));

vi.mock("../config.js", () => ({
  buildUserProfile: (cfg: unknown) => mockBuildUserProfile(cfg),
}));

import { buildClaudeCodeSystemPrompt } from "./system-prompt.js";

describe("buildClaudeCodeSystemPrompt", () => {
  beforeEach(() => {
    mockLoadProjectContext.mockReset().mockReturnValue("");
    mockLoadInstructionContext.mockReset().mockReturnValue("");
    mockBuildUserProfile.mockReset().mockReturnValue("");
  });

  it("returns preset-only when no sections have content", () => {
    const result = buildClaudeCodeSystemPrompt();
    expect(result).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("returns preset with append when instructions are present", () => {
    mockLoadInstructionContext.mockReturnValue("\n\n## Project Instructions\n\nsome rule");
    const result = buildClaudeCodeSystemPrompt();
    expect(result).toMatchObject({ type: "preset", preset: "claude_code" });
    expect((result as { append?: string }).append).toContain("some rule");
  });

  it("passes startDir to loadInstructionContext and loadProjectContext", () => {
    const dir = "/some/deep/dir";
    buildClaudeCodeSystemPrompt(undefined, undefined, dir);
    expect(mockLoadInstructionContext).toHaveBeenCalledWith(dir);
    expect(mockLoadProjectContext).toHaveBeenCalledWith(dir);
  });

  it("passes undefined startDir when not provided", () => {
    buildClaudeCodeSystemPrompt();
    expect(mockLoadInstructionContext).toHaveBeenCalledWith(undefined);
    expect(mockLoadProjectContext).toHaveBeenCalledWith(undefined);
  });

  it("includes extra instructions under autonomous section", () => {
    const result = buildClaudeCodeSystemPrompt(undefined, "do the thing");
    expect((result as { append?: string }).append).toContain(
      "## Autonomous Agent Instructions",
    );
    expect((result as { append?: string }).append).toContain("do the thing");
  });

  it("omits extra instructions section when empty string provided", () => {
    mockLoadInstructionContext.mockReturnValue("\n\nsome rules");
    const result = buildClaudeCodeSystemPrompt(undefined, "   ");
    expect((result as { append?: string }).append).not.toContain(
      "## Autonomous Agent Instructions",
    );
  });
});
