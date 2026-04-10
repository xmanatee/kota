import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadProjectContext = vi.fn((_dir?: string, _rootDir?: string) => "");
const mockLoadInstructionContext = vi.fn(
  (_dir?: string, _rootDir?: string) => "",
);
const mockBuildUserProfile = vi.fn((_cfg: unknown) => "");

vi.mock("#root/project-context.js", () => ({
  loadProjectContext: (dir?: string, rootDir?: string) =>
    mockLoadProjectContext(dir, rootDir),
}));

vi.mock("#root/instruction-files.js", () => ({
  loadInstructionContext: (dir?: string, rootDir?: string) =>
    mockLoadInstructionContext(dir, rootDir),
}));

vi.mock("#core/config/config.js", () => ({
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

  it("passes startDir and rootDir to loadInstructionContext and loadProjectContext", () => {
    const dir = "/some/deep/dir";
    const rootDir = "/some/repo";
    buildClaudeCodeSystemPrompt(undefined, undefined, dir, rootDir);
    expect(mockLoadInstructionContext).toHaveBeenCalledWith(dir, rootDir);
    expect(mockLoadProjectContext).toHaveBeenCalledWith(dir, rootDir);
  });

  it("passes undefined startDir and rootDir when not provided", () => {
    buildClaudeCodeSystemPrompt();
    expect(mockLoadInstructionContext).toHaveBeenCalledWith(undefined, undefined);
    expect(mockLoadProjectContext).toHaveBeenCalledWith(undefined, undefined);
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
