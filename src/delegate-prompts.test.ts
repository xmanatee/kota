import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXECUTE_TOOL_NAMES,
  EXPLORE_PROMPT,
  EXPLORE_TOOL_NAMES,
  getExecuteToolSet,
  getExploreToolSet,
  getResearchToolSet,
  RESEARCH_PROMPT,
} from "#core/agents/delegate-prompts.js";

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

  it("appends instruction context when provided", () => {
    const result = buildSubAgentPrompt(base, {
      instructionContext: "## Project Instructions\n\nFollow AGENTS.md",
    });
    expect(result).toContain("Follow AGENTS.md");
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

  it("does not include empty instruction context", () => {
    const result = buildSubAgentPrompt(base, { instructionContext: "" });
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

  it("EXPLORE_PROMPT includes data analysis guidance with code_exec", () => {
    expect(EXPLORE_PROMPT).toContain("code_exec");
    expect(EXPLORE_PROMPT).toContain("matplotlib");
    expect(EXPLORE_PROMPT).toContain("data analysis");
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

  it("EXPLORE_PROMPT includes source quality guidance", () => {
    expect(EXPLORE_PROMPT).toContain("primary sources");
    expect(EXPLORE_PROMPT).toContain("publication dates");
    expect(EXPLORE_PROMPT).toContain("inaccessible");
  });

  it("EXPLORE_PROMPT includes structured data pipeline guidance", () => {
    expect(EXPLORE_PROMPT).toContain("save_to");
    expect(EXPLORE_PROMPT).toContain("code_exec to parse");
    expect(EXPLORE_PROMPT).toContain("don't manually extract");
  });

  it("EXPLORE_PROMPT includes conflict resolution and presentation format", () => {
    expect(EXPLORE_PROMPT).toContain("sources conflict");
    expect(EXPLORE_PROMPT).toContain("executive summary");
    expect(EXPLORE_PROMPT).toContain("source dates");
  });

  it("EXPLORE_PROMPT includes API exploration guidance", () => {
    expect(EXPLORE_PROMPT).toContain("http_request");
    expect(EXPLORE_PROMPT).toContain("API");
  });

  it("EXECUTE_PROMPT mentions all available tool categories", () => {
    expect(EXECUTE_PROMPT).toContain("file_write");
    expect(EXECUTE_PROMPT).toContain("code_exec");
    expect(EXECUTE_PROMPT).toContain("web_search");
    expect(EXECUTE_PROMPT).toContain("http_request");
  });

  it("EXECUTE_PROMPT includes guidance for non-code tasks", () => {
    expect(EXECUTE_PROMPT).toContain("writing/planning tasks");
    expect(EXECUTE_PROMPT).toContain("outline");
  });

  it("EXECUTE_PROMPT includes re-verify guidance", () => {
    expect(EXECUTE_PROMPT).toContain("re-verify");
  });
});

describe("buildSubAgentPrompt × init.ts — delegate environment context", () => {
  const base = "You are a sub-agent.";
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    tmpDir = mkdtempSync(join(tmpdir(), "delegate-ctx-"));
  });

  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes project type when cwd has package.json", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18" } }),
    );
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("Project:");
    expect(result).toContain("Node.js project");
    expect(result).toContain("react");
  });

  it("includes directory overview when cwd has files", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(tmpDir, "index.ts"), "export {}");
    writeFileSync(join(tmpDir, "README.md"), "# Hello");
    mkdirSync(join(tmpDir, "src"));
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("Directory:");
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
  });

  it("omits project and directory for empty dir", async () => {
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).not.toContain("Project:");
    expect(result).not.toContain("Directory:");
    expect(result).toContain("Working directory:");
  });

  it("orders: cwd → project → directory → projectContext → instructionContext", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-app" }),
    );
    writeFileSync(join(tmpDir, "app.js"), "");
    const result = buildSubAgentPrompt(base, {
      cwd: tmpDir,
      projectContext: "## Rules\nUse tabs.",
      instructionContext: "## Project Instructions\nRead AGENTS.md",
    });
    const cwdIdx = result.indexOf("Working directory:");
    const projIdx = result.indexOf("Project:");
    const dirIdx = result.indexOf("Directory:");
    const ctxIdx = result.indexOf("Use tabs.");
    const instructionsIdx = result.indexOf("Read AGENTS.md");
    expect(cwdIdx).toBeLessThan(projIdx);
    expect(projIdx).toBeLessThan(dirIdx);
    expect(dirIdx).toBeLessThan(ctxIdx);
    expect(ctxIdx).toBeLessThan(instructionsIdx);
  });

  it("filters noise directories from delegate overview", async () => {
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(tmpDir, "src"));
    mkdirSync(join(tmpDir, "node_modules"));
    mkdirSync(join(tmpDir, ".git"));
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("src/");
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".git");
  });

  it("includes Python project detection from pyproject.toml", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(
      join(tmpDir, "pyproject.toml"),
      '[project]\nname = "data-analyzer"',
    );
    writeFileSync(join(tmpDir, "main.py"), "print('hi')");
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("Python project");
    expect(result).toContain("data-analyzer");
    expect(result).toContain("main.py");
  });

  it("includes Go project detection from go.mod", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(
      join(tmpDir, "go.mod"),
      "module github.com/user/service\n\ngo 1.21",
    );
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("Go project");
    expect(result).toContain("github.com/user/service");
  });

  it("handles non-existent cwd gracefully — no crash", () => {
    const result = buildSubAgentPrompt(base, {
      cwd: "/tmp/kota-nonexistent-path-test-42",
    });
    expect(result).toContain("Working directory:");
    expect(result).not.toContain("Project:");
    expect(result).not.toContain("Directory:");
  });

  it("truncates large directory listing through delegate prompt", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (let i = 0; i < 12; i++) mkdirSync(join(tmpDir, `dir${String(i).padStart(2, "0")}`));
    for (let i = 0; i < 18; i++) writeFileSync(join(tmpDir, `f${String(i).padStart(2, "0")}.txt`), "");
    const result = buildSubAgentPrompt(base, { cwd: tmpDir });
    expect(result).toContain("+2 more");
    expect(result).toContain("+3 more");
  });
});

describe("tool name sets", () => {
  it("explore names include research + shell for info gathering (no file_edit, file_write)", () => {
    expect(EXPLORE_TOOL_NAMES).toContain("file_read");
    expect(EXPLORE_TOOL_NAMES).toContain("grep");
    expect(EXPLORE_TOOL_NAMES).toContain("glob");
    expect(EXPLORE_TOOL_NAMES).toContain("files_overview");
    expect(EXPLORE_TOOL_NAMES).toContain("web_search");
    expect(EXPLORE_TOOL_NAMES).toContain("code_exec");
    expect(EXPLORE_TOOL_NAMES).toContain("shell");
    expect(EXPLORE_TOOL_NAMES).not.toContain("file_edit");
    expect(EXPLORE_TOOL_NAMES).not.toContain("file_write");
  });

  it("EXPLORE_PROMPT includes files_overview guidance for directory orientation", () => {
    expect(EXPLORE_PROMPT).toContain("files_overview");
    expect(EXPLORE_PROMPT).toContain("directory orientation");
  });

  it("EXPLORE_PROMPT includes shell guidance for system info", () => {
    expect(EXPLORE_PROMPT).toContain("shell");
    expect(EXPLORE_PROMPT).toContain("system info");
    expect(EXPLORE_PROMPT).toContain("information gathering");
  });

  it("execute names include all explore names plus mutation tools", () => {
    for (const name of EXPLORE_TOOL_NAMES) {
      expect(EXECUTE_TOOL_NAMES).toContain(name);
    }
    expect(EXECUTE_TOOL_NAMES).toContain("file_edit");
    expect(EXECUTE_TOOL_NAMES).toContain("file_write");
    expect(EXECUTE_TOOL_NAMES).toContain("multi_edit");
    expect(EXECUTE_TOOL_NAMES).toContain("shell");
  });

  it("explore names do not contain duplicates", () => {
    expect(new Set(EXPLORE_TOOL_NAMES).size).toBe(EXPLORE_TOOL_NAMES.length);
  });

  it("execute names do not contain duplicates", () => {
    expect(new Set(EXECUTE_TOOL_NAMES).size).toBe(EXECUTE_TOOL_NAMES.length);
  });
});

describe("tool set resolution (requires module tools registered)", () => {
  it("getExploreToolSet returns tools and runners with matching names", () => {
    const { tools, runners } = getExploreToolSet();
    const toolNames = tools.map((t) => t.name).sort();
    const runnerNames = Object.keys(runners).sort();
    expect(runnerNames).toEqual(toolNames);
  });

  it("getExecuteToolSet returns tools and runners with matching names", () => {
    const { tools, runners } = getExecuteToolSet();
    const toolNames = tools.map((t) => t.name).sort();
    const runnerNames = Object.keys(runners).sort();
    expect(runnerNames).toEqual(toolNames);
  });

  it("getResearchToolSet returns tools and runners with matching names", () => {
    const { tools, runners } = getResearchToolSet();
    const toolNames = tools.map((t) => t.name).sort();
    const runnerNames = Object.keys(runners).sort();
    expect(runnerNames).toEqual(toolNames);
  });

  it("shell tool in explore set has bounded description", () => {
    const { tools } = getExploreToolSet();
    const shell = tools.find((t) => t.name === "shell");
    if (shell) {
      expect(shell.description).toContain("max 60s timeout");
    }
  });
});

describe("RESEARCH_PROMPT", () => {
  it("includes multi-step research workflow", () => {
    expect(RESEARCH_PROMPT).toContain("Decompose");
    expect(RESEARCH_PROMPT).toContain("Search broadly");
    expect(RESEARCH_PROMPT).toContain("Read deeply");
    expect(RESEARCH_PROMPT).toContain("Evaluate gaps");
    expect(RESEARCH_PROMPT).toContain("Cross-reference");
    expect(RESEARCH_PROMPT).toContain("Synthesize");
  });

  it("includes iterative deepening guidance (up to 3 rounds)", () => {
    expect(RESEARCH_PROMPT).toContain("up to 3 rounds");
    expect(RESEARCH_PROMPT).toContain("follow-up queries");
  });

  it("includes tool strategy for research", () => {
    expect(RESEARCH_PROMPT).toContain("web_search");
    expect(RESEARCH_PROMPT).toContain("web_fetch");
    expect(RESEARCH_PROMPT).toContain("http_request");
    expect(RESEARCH_PROMPT).toContain("code_exec");
    expect(RESEARCH_PROMPT).toContain("grep");
  });

  it("includes source quality guidance", () => {
    expect(RESEARCH_PROMPT).toContain("publication dates");
    expect(RESEARCH_PROMPT).toContain("primary sources");
    expect(RESEARCH_PROMPT).toContain("inaccessible");
    expect(RESEARCH_PROMPT).toContain("provenance");
  });

  it("includes structured response format with provenance", () => {
    expect(RESEARCH_PROMPT).toContain("Executive summary");
    expect(RESEARCH_PROMPT).toContain("Key findings");
    expect(RESEARCH_PROMPT).toContain("Confidence");
    expect(RESEARCH_PROMPT).toContain("Contradictions");
    expect(RESEARCH_PROMPT).toContain("Sources");
  });

  it("guides batching independent tool calls", () => {
    expect(RESEARCH_PROMPT).toContain("Batch independent tool calls");
  });

  it("is read-only — does not mention file modification", () => {
    expect(RESEARCH_PROMPT).not.toContain("file_edit");
    expect(RESEARCH_PROMPT).not.toContain("file_write");
    expect(RESEARCH_PROMPT).not.toContain("multi_edit");
  });
});
