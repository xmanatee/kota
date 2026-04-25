import { describe, expect, it } from "vitest";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import { inspectAgent, listAgents } from "./agent-ops-operations.js";

function stubCtx(
  summaries: ModuleSummary[],
  agentModels: Record<string, string> = {},
): ModuleContext {
  return {
    cwd: "/tmp",
    config: { agentModels },
    getModuleSummaries: () => summaries,
  } as unknown as ModuleContext;
}

function moduleSummary(name: string, agents: ModuleSummary["agents"]): ModuleSummary {
  return {
    name,
    source: "project",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: [],
    agentNames: agents.map((a) => a.name),
    agents,
    skills: [],
    commandNames: [],
    routeSummaries: [],
  };
}

describe("agent-ops operations (local handler / daemon-down branch)", () => {
  it("listAgents resolves operator overrides over the agent's declared model", () => {
    const ctx = stubCtx(
      [
        moduleSummary("autonomy", [
          {
            name: "builder",
            role: "builder",
            promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            model: "claude-sonnet-4-6",
            effort: "xhigh",
            writeScope: [],
          },
        ]),
      ],
      { builder: "claude-opus-4-7" },
    );
    const result = listAgents(ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "builder",
      source: "autonomy",
      model: "claude-opus-4-7",
      effort: "xhigh",
    });
  });

  it("listAgents drops duplicates so the first contributor wins", () => {
    const ctx = stubCtx([
      moduleSummary("autonomy", [
        {
          name: "critic",
          role: "critic",
          promptPath: "p1",
          model: "m1",
          effort: "xhigh",
          writeScope: [],
        },
      ]),
      moduleSummary("other", [
        {
          name: "critic",
          role: "shadow critic",
          promptPath: "p2",
          model: "m2",
          effort: "xhigh",
          writeScope: [],
        },
      ]),
    ]);
    const result = listAgents(ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].source).toBe("autonomy");
  });

  it("inspectAgent surfaces a typed not_found result", () => {
    const ctx = stubCtx([]);
    const result = inspectAgent(ctx, "missing");
    expect(result).toEqual({ found: false });
  });

  it("inspectAgent returns the resolved agent when present", () => {
    const ctx = stubCtx([
      moduleSummary("autonomy", [
        {
          name: "decomposer",
          role: "decomposer",
          promptPath: "p",
          model: "m",
          effort: "xhigh",
          writeScope: ["data/tasks/"],
        },
      ]),
    ]);
    const result = inspectAgent(ctx, "decomposer");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.agent.name).toBe("decomposer");
      expect(result.agent.writeScope).toEqual(["data/tasks/"]);
    }
  });
});
