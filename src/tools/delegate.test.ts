import { describe, it, expect } from "vitest";
import { extractModifiedFiles, buildSubAgentPrompt, type DelegateConfig } from "./delegate.js";

describe("buildSubAgentPrompt", () => {
  const base = "You are a research assistant.";

  it("returns base prompt when no context provided", () => {
    const config: DelegateConfig = { model: "claude-sonnet-4-6" };
    expect(buildSubAgentPrompt(base, config)).toBe(base);
  });

  it("appends working directory when cwd is set", () => {
    const config: DelegateConfig = { model: "claude-sonnet-4-6", cwd: "/home/user/project" };
    const result = buildSubAgentPrompt(base, config);
    expect(result).toContain("Working directory: /home/user/project");
    expect(result.startsWith(base)).toBe(true);
  });

  it("appends project context when provided", () => {
    const config: DelegateConfig = {
      model: "claude-sonnet-4-6",
      projectContext: "## Project Context\n\nThis is a Node.js app.",
    };
    const result = buildSubAgentPrompt(base, config);
    expect(result).toContain("This is a Node.js app.");
  });

  it("includes both cwd and project context", () => {
    const config: DelegateConfig = {
      model: "claude-sonnet-4-6",
      cwd: "/opt/app",
      projectContext: "## Conventions\n\nUse ESM imports.",
    };
    const result = buildSubAgentPrompt(base, config);
    expect(result).toContain("Working directory: /opt/app");
    expect(result).toContain("Use ESM imports.");
    // cwd should come before project context
    const cwdIdx = result.indexOf("/opt/app");
    const ctxIdx = result.indexOf("Use ESM");
    expect(cwdIdx).toBeLessThan(ctxIdx);
  });

  it("does not include empty cwd", () => {
    const config: DelegateConfig = { model: "claude-sonnet-4-6", cwd: "" };
    const result = buildSubAgentPrompt(base, config);
    expect(result).not.toContain("Working directory");
  });

  it("does not include empty project context", () => {
    const config: DelegateConfig = { model: "claude-sonnet-4-6", projectContext: "" };
    const result = buildSubAgentPrompt(base, config);
    expect(result).toBe(base);
  });
});

describe("extractModifiedFiles", () => {
  it("extracts path from file_edit", () => {
    expect(extractModifiedFiles("file_edit", { path: "src/foo.ts" })).toEqual([
      "src/foo.ts",
    ]);
  });

  it("extracts path from file_write", () => {
    expect(
      extractModifiedFiles("file_write", { path: "src/bar.ts" }),
    ).toEqual(["src/bar.ts"]);
  });

  it("returns empty for file_edit without path", () => {
    expect(extractModifiedFiles("file_edit", {})).toEqual([]);
  });

  it("extracts paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { path: "src/b.ts", old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("handles multi_edit with file_path field", () => {
    const input = {
      edits: [{ file_path: "src/c.ts", old_string: "x", new_string: "y" }],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/c.ts"]);
  });

  it("filters empty paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/a.ts"]);
  });

  it("returns empty for multi_edit without edits", () => {
    expect(extractModifiedFiles("multi_edit", {})).toEqual([]);
  });

  it("returns empty for read-only tools", () => {
    expect(extractModifiedFiles("file_read", { path: "src/x.ts" })).toEqual(
      [],
    );
    expect(extractModifiedFiles("grep", { pattern: "foo" })).toEqual([]);
    expect(extractModifiedFiles("glob", { pattern: "*.ts" })).toEqual([]);
    expect(extractModifiedFiles("shell", { command: "ls" })).toEqual([]);
  });
});
