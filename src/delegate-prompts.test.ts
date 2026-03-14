import { describe, it, expect } from "vitest";
import {
  EXPLORE_PROMPT,
  EXECUTE_PROMPT,
  buildSubAgentPrompt,
  exploreTools,
  executeTools,
  exploreRunners,
  executeRunners,
} from "./delegate-prompts.js";

describe("buildSubAgentPrompt", () => {
  const base = "You are a research assistant.";

  it("returns base prompt when no context provided", () => {
    expect(buildSubAgentPrompt(base, {})).toBe(base);
  });

  it("appends working directory when cwd is set", () => {
    const result = buildSubAgentPrompt(base, { cwd: "/home/user/project" });
    expect(result).toContain("Working directory: /home/user/project");
    expect(result.startsWith(base)).toBe(true);
  });

  it("appends project context when provided", () => {
    const result = buildSubAgentPrompt(base, {
      projectContext: "## Project Context\n\nThis is a Node.js app.",
    });
    expect(result).toContain("This is a Node.js app.");
  });

  it("includes both cwd and project context in order", () => {
    const result = buildSubAgentPrompt(base, {
      cwd: "/opt/app",
      projectContext: "## Conventions\n\nUse ESM imports.",
    });
    expect(result).toContain("Working directory: /opt/app");
    expect(result).toContain("Use ESM imports.");
    const cwdIdx = result.indexOf("/opt/app");
    const ctxIdx = result.indexOf("Use ESM");
    expect(cwdIdx).toBeLessThan(ctxIdx);
  });

  it("does not include empty cwd", () => {
    const result = buildSubAgentPrompt(base, { cwd: "" });
    expect(result).not.toContain("Working directory");
  });

  it("does not include empty project context", () => {
    const result = buildSubAgentPrompt(base, { projectContext: "" });
    expect(result).toBe(base);
  });
});

describe("sub-agent prompts", () => {
  it("EXPLORE_PROMPT includes research workflow guidance", () => {
    expect(EXPLORE_PROMPT).toContain("repo_map");
    expect(EXPLORE_PROMPT).toContain("web_search");
    expect(EXPLORE_PROMPT).toContain("read-only");
    expect(EXPLORE_PROMPT).toContain("Batch independent tool calls");
  });

  it("EXECUTE_PROMPT includes implementation guidance", () => {
    expect(EXECUTE_PROMPT).toContain("Read files before editing");
    expect(EXECUTE_PROMPT).toContain("file_edit");
    expect(EXECUTE_PROMPT).toContain("multi_edit");
    expect(EXECUTE_PROMPT).toContain("verify");
  });

  it("EXECUTE_PROMPT includes error recovery guidance", () => {
    expect(EXECUTE_PROMPT).toContain("Error Recovery");
    expect(EXECUTE_PROMPT).toContain("re-read the file");
    expect(EXECUTE_PROMPT).toContain("Shell command fails");
  });
});

describe("tool sets", () => {
  it("explore tools are read-only (no file_edit, file_write, shell)", () => {
    const names = exploreTools.map((t) => t.name);
    expect(names).toContain("file_read");
    expect(names).toContain("grep");
    expect(names).toContain("glob");
    expect(names).toContain("web_search");
    expect(names).not.toContain("file_edit");
    expect(names).not.toContain("file_write");
    expect(names).not.toContain("shell");
  });

  it("execute tools include all explore tools plus mutation tools", () => {
    const names = executeTools.map((t) => t.name);
    // All explore tools present
    for (const t of exploreTools) {
      expect(names).toContain(t.name);
    }
    // Plus mutation tools
    expect(names).toContain("file_edit");
    expect(names).toContain("file_write");
    expect(names).toContain("multi_edit");
    expect(names).toContain("shell");
  });

  it("runners match tool definitions", () => {
    const exploreToolNames = exploreTools.map((t) => t.name).sort();
    const exploreRunnerNames = Object.keys(exploreRunners).sort();
    expect(exploreRunnerNames).toEqual(exploreToolNames);

    const executeToolNames = executeTools.map((t) => t.name).sort();
    const executeRunnerNames = Object.keys(executeRunners).sort();
    expect(executeRunnerNames).toEqual(executeToolNames);
  });
});
