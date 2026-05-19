import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  localDestructiveEffect,
  localWriteEffect,
  networkReadEffect,
  readOnlyLocalEffect,
  sessionWriteEffect,
  type ToolEffect,
} from "#core/tools/effect.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXPLORE_PROMPT,
  getExecuteToolSet,
  getExploreToolSet,
  getResearchToolSet,
  RESEARCH_PROMPT,
} from "./delegate-prompts.js";

const MODULE_TOOL_NAMES = [
  "file_read",
  "file_write",
  "file_edit",
  "multi_edit",
  "find_replace",
  "grep",
  "glob",
  "repo_map",
  "files_overview",
  "web_fetch",
  "web_search",
  "http_request",
  "code_exec",
  "computer_use",
];

function makeTool(name: string, description: string): KotaTool {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        save_to: { type: "string" },
      },
      required: ["path"],
    },
  };
}

describe("buildSubAgentPrompt", () => {
  const base = "You are a research assistant.";

  it("returns base prompt when no context or tool guidance is provided", () => {
    expect(buildSubAgentPrompt(base, {})).toBe(base);
  });

  it("appends generated tool metadata before environment context", () => {
    const result = buildSubAgentPrompt(base, {
      cwd: "/home/user/project",
      tools: [
        makeTool(
          "example_read",
          "Read example files from the active project.",
        ),
      ],
    });

    expect(result).toContain("<available-tools>");
    expect(result).toContain("- example_read:");
    expect(result).toContain("path*");
    expect(result).toContain("save_to");
    expect(result).toContain("Working directory: /home/user/project");
    expect(result.indexOf("<available-tools>")).toBeLessThan(
      result.indexOf("Working directory:"),
    );
  });

  it("appends native harness tool names through the same available-tools shape", () => {
    const result = buildSubAgentPrompt(base, {
      toolNames: ["Write", "Read", "Read"],
    });

    expect(result).toContain("<available-tools>");
    expect(result).toContain("- Read");
    expect(result).toContain("- Write");
    expect(result.match(/- Read/g)).toHaveLength(1);
  });

  it("appends project and instruction context after working directory details", () => {
    const result = buildSubAgentPrompt(base, {
      cwd: "/opt/app",
      projectContext: "## Conventions\n\nUse ESM imports.",
      instructionContext: "## Project Instructions\n\nRead AGENTS.md",
    });

    const cwdIdx = result.indexOf("/opt/app");
    const ctxIdx = result.indexOf("Use ESM");
    const instructionsIdx = result.indexOf("Read AGENTS.md");
    expect(cwdIdx).toBeLessThan(ctxIdx);
    expect(ctxIdx).toBeLessThan(instructionsIdx);
  });

  it("does not include empty optional context", () => {
    expect(buildSubAgentPrompt(base, { cwd: "" })).toBe(base);
    expect(buildSubAgentPrompt(base, { projectContext: "" })).toBe(base);
    expect(buildSubAgentPrompt(base, { instructionContext: "" })).toBe(base);
  });
});

describe("sub-agent base prompts", () => {
  it("retain role-local research, execution, and response guidance", () => {
    expect(EXPLORE_PROMPT).toContain("research sub-agent");
    expect(EXPLORE_PROMPT).toContain("read-only access");
    expect(EXPLORE_PROMPT).toContain("primary sources");
    expect(EXPLORE_PROMPT).toContain("Response Format");

    expect(RESEARCH_PROMPT).toContain("Decompose");
    expect(RESEARCH_PROMPT).toContain("Evaluate gaps");
    expect(RESEARCH_PROMPT).toContain("provenance");

    expect(EXECUTE_PROMPT).toContain("task execution sub-agent");
    expect(EXECUTE_PROMPT).toContain("Read files before editing");
    expect(EXECUTE_PROMPT).toContain("re-verify");
  });

  it("do not hardcode a module-owned tool catalog", () => {
    const prompts = [EXPLORE_PROMPT, RESEARCH_PROMPT, EXECUTE_PROMPT];
    for (const prompt of prompts) {
      for (const name of MODULE_TOOL_NAMES) {
        expect(prompt).not.toContain(name);
      }
    }
  });

  it("point agents at generated tool metadata instead of fixed tool names", () => {
    for (const prompt of [EXPLORE_PROMPT, RESEARCH_PROMPT, EXECUTE_PROMPT]) {
      expect(prompt).toContain("generated available-tool metadata");
      expect(prompt).toContain("source of truth");
    }
  });
});

describe("buildSubAgentPrompt environment context", () => {
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

  it("includes project type and directory overview when cwd has files", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18" } }),
    );
    writeFileSync(join(tmpDir, "index.ts"), "export {}");
    mkdirSync(join(tmpDir, "src"));

    const result = buildSubAgentPrompt(basePrompt(), { cwd: tmpDir });

    expect(result).toContain("Project:");
    expect(result).toContain("Node.js project");
    expect(result).toContain("react");
    expect(result).toContain("Directory:");
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
  });

  it("omits project and directory for an empty directory", () => {
    const result = buildSubAgentPrompt(basePrompt(), { cwd: tmpDir });

    expect(result).toContain("Working directory:");
    expect(result).not.toContain("Project:");
    expect(result).not.toContain("Directory:");
  });
});

describe("delegate tool mode selection", () => {
  afterEach(() => {
    clearCustomTools();
  });

  it("derives explore tools from registered read-effect tool metadata", () => {
    registerDelegateTestTool("delegate_read_local", readOnlyLocalEffect());
    registerDelegateTestTool("delegate_read_network", networkReadEffect());
    registerDelegateTestTool("delegate_write_local", localWriteEffect());
    registerDelegateTestTool("delegate_destructive", localDestructiveEffect());

    const names = getExploreToolSet().tools.map((t) => t.name);

    expect(names).toContain("delegate_read_local");
    expect(names).toContain("delegate_read_network");
    expect(names).not.toContain("delegate_write_local");
    expect(names).not.toContain("delegate_destructive");
  });

  it("derives execute tools from registered non-destructive tool metadata", () => {
    registerDelegateTestTool("delegate_read_local", readOnlyLocalEffect());
    registerDelegateTestTool("delegate_write_local", localWriteEffect());
    registerDelegateTestTool("delegate_write_session", sessionWriteEffect());
    registerDelegateTestTool("delegate_destructive", localDestructiveEffect());

    const names = getExecuteToolSet().tools.map((t) => t.name);

    expect(names).toContain("delegate_read_local");
    expect(names).toContain("delegate_write_local");
    expect(names).toContain("delegate_write_session");
    expect(names).not.toContain("delegate_destructive");
  });

  it("research uses the same read-effect selection as explore", () => {
    registerDelegateTestTool("delegate_read_local", readOnlyLocalEffect());
    registerDelegateTestTool("delegate_write_local", localWriteEffect());

    expect(getResearchToolSet().tools.map((t) => t.name)).toEqual(
      getExploreToolSet().tools.map((t) => t.name),
    );
  });
});

describe("tool set resolution", () => {
  afterEach(() => {
    clearCustomTools();
  });

  it("getExploreToolSet returns tools and runners with matching names", () => {
    registerDelegateTestTool("delegate_read_local", readOnlyLocalEffect());
    const { tools, runners } = getExploreToolSet();
    expect(Object.keys(runners).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("getExecuteToolSet returns tools and runners with matching names", () => {
    registerDelegateTestTool("delegate_write_local", localWriteEffect());
    const { tools, runners } = getExecuteToolSet();
    expect(Object.keys(runners).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("getResearchToolSet returns tools and runners with matching names", () => {
    registerDelegateTestTool("delegate_read_local", readOnlyLocalEffect());
    const { tools, runners } = getResearchToolSet();
    expect(Object.keys(runners).sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

function basePrompt(): string {
  return "You are a sub-agent.";
}

function registerDelegateTestTool(
  name: string,
  effect: ToolEffect,
): void {
  registerTool(
    makeTool(name, `Test delegate tool ${name}`),
    async () => ({ content: `${name} result` }),
    "delegate-prompts-test",
    { effect },
  );
}
