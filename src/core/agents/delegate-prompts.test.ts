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
  getExecuteToolSet,
  getExploreToolSet,
  getResearchToolSet,
} from "./delegate-prompts.js";

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

	it("appends scope and instruction context after working directory details", () => {
    const result = buildSubAgentPrompt(base, {
      cwd: "/opt/app",
      scopeContext: "## Conventions\n\nUse ESM imports.",
		instructionContext: "## Workspace Instructions\n\nRead AGENTS.md",
    });

    const cwdIdx = result.indexOf("/opt/app");
    const ctxIdx = result.indexOf("Use ESM");
    const instructionsIdx = result.indexOf("Read AGENTS.md");
    expect(cwdIdx).toBeLessThan(ctxIdx);
    expect(ctxIdx).toBeLessThan(instructionsIdx);
  });

  it("does not include empty optional context", () => {
    expect(buildSubAgentPrompt(base, { cwd: "" })).toBe(base);
    expect(buildSubAgentPrompt(base, { scopeContext: "" })).toBe(base);
    expect(buildSubAgentPrompt(base, { instructionContext: "" })).toBe(base);
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

	it("includes workspace type and directory overview when cwd has files", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18" } }),
    );
    writeFileSync(join(tmpDir, "index.ts"), "export {}");
    mkdirSync(join(tmpDir, "src"));

    const result = buildSubAgentPrompt(basePrompt(), { cwd: tmpDir });

		expect(result).toContain("Workspace:");
		expect(result).toContain("Node.js workspace");
    expect(result).toContain("react");
    expect(result).toContain("Directory:");
    expect(result).toContain("src/");
    expect(result).toContain("index.ts");
  });

	it("omits workspace and directory for an empty directory", () => {
    const result = buildSubAgentPrompt(basePrompt(), { cwd: tmpDir });

    expect(result).toContain("Working directory:");
		expect(result).not.toContain("Workspace:");
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
