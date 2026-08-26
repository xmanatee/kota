import { describe, expect, it } from "vitest";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import {
  inspectAgent,
  listAgents,
  listAgentsFromSummaries,
} from "./agent-ops-operations.js";

function stubCtx(
  summaries: ModuleSummary[],
  agentModels: Record<string, string> = {},
): ModuleContext {
  return {
    cwd: "/tmp",
    config: { agentModels },
    getModuleSummaries: () => summaries,
    getContributedWorkflows: () => [],
  } as unknown as ModuleContext;
}

function moduleSummary(
  name: string,
  agents: ModuleSummary["agents"],
  overrides: Partial<ModuleSummary> = {},
): ModuleSummary {
  const skills = overrides.skills ?? [];
  return {
    name,
    source: "bundled",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: skills.map((skill) => skill.name),
    agentNames: agents.map((a) => a.name),
    agents,
    skills,
    commandNames: [],
    routeSummaries: [],
    ...overrides,
  };
}

describe("agent-ops operations (local handler / daemon-down branch)", () => {
  it("listAgents resolves operator overrides over the agent's declared model", async () => {
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
    const result = await listAgents(ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "builder",
      source: "autonomy",
      moduleSource: "bundled",
      sourcePath: "src/modules/autonomy",
      model: "claude-opus-4-7",
      effort: "xhigh",
      toolPolicy: { posture: "inherits-session" },
    });
  });

  it("listAgents drops duplicates so the first contributor wins", async () => {
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
    const result = await listAgents(ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].source).toBe("autonomy");
  });

  it("listAgentsFromSummaries resolves module context, source paths, skills, setup readiness, and tool policy", () => {
    const result = listAgentsFromSummaries([
      moduleSummary(
        "autonomy",
        [
          {
            name: "builder",
            role: "builder",
            promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            model: "claude-opus-4-7",
            effort: "xhigh",
            skills: ["tool-cache"],
            tools: { allowed: ["Read"], disallowed: ["Bash"] },
            writeScope: [],
          },
        ],
        {
          workflowNames: ["builder"],
          channelNames: ["telegram"],
          skills: [
            {
              name: "tool-cache",
              description: "Cache read-only tool results.",
              promptPath: "src/modules/tool-cache/tool-cache.md",
              roles: ["builder"],
            },
          ],
          manifest: {
            schemaVersion: 1,
            moduleName: "autonomy",
            dependencies: [],
            capabilities: [],
            dataClasses: [],
            contributions: {
              tools: [],
              workflows: ["builder"],
              workflowTriggers: [],
              channels: ["telegram"],
              skills: ["tool-cache"],
              agents: ["builder"],
              commands: [],
              routes: [],
              controlRoutes: [],
              events: [],
              eventFlows: [],
              clients: { localNamespaces: [], daemonFactory: false },
              setupRequirements: [
                {
                  id: "github-oauth",
                  kind: "oauth",
                  setupMode: "url",
                  sensitivity: "oauth",
                  required: true,
                  healthCapabilityIds: [],
                  statusLinks: {
                    list: "/setup/requirements",
                    refresh: "/setup/requirements/autonomy/github-oauth/refresh",
                    revoke: "/setup/requirements/autonomy/github-oauth",
                    storeSecret: "/setup/requirements/autonomy/github-oauth/secret",
                    start: "/setup/requirements/autonomy/github-oauth/start",
                  },
                  availability: {
                    state: "missing",
                    reason: "secret_missing",
                    message: "GitHub OAuth is not configured.",
                  },
                },
              ],
            },
            effects: [],
            simulation: { support: "full", blockedReasons: [] },
            readiness: {
              setupRequirementIds: ["github-oauth"],
              healthCapabilityIds: [],
              healthCheck: "not-declared",
            },
          },
        },
      ),
    ]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "builder",
      source: "autonomy",
      moduleSource: "bundled",
      sourcePath: "src/modules/autonomy",
      sourcePaths: [
        "src/modules/autonomy",
        "src/modules/autonomy/workflows/builder/prompt.md",
        "src/modules/tool-cache/tool-cache.md",
      ],
      resolvedSkills: [
        {
          name: "tool-cache",
          source: "autonomy",
          promptPath: "src/modules/tool-cache/tool-cache.md",
        },
      ],
      toolPolicy: {
        posture: "allow-list-with-deny-list",
        allowed: ["Read"],
        disallowed: ["Bash"],
      },
      workflows: ["builder"],
      workflowUsages: [],
      channels: ["telegram"],
      setupRequirements: [
        {
          id: "github-oauth",
          kind: "oauth",
          required: true,
          sensitivity: "oauth",
          state: "missing",
          reason: "secret_missing",
          message: "GitHub OAuth is not configured.",
        },
      ],
    });
    const serialized = JSON.stringify(result.agents[0]);
    expect(serialized).not.toContain("secretRefs");
    expect(serialized).not.toContain("token");
  });

  it("inspectAgent surfaces a typed not_found result", async () => {
    const ctx = stubCtx([]);
    const result = await inspectAgent(ctx, "missing");
    expect(result).toEqual({ found: false });
  });

  it("inspectAgent returns the resolved agent when present", async () => {
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
    ctx.getContributedWorkflows = () => [
      {
        repository: "read",
        name: "decomposer",
        definitionPath: "src/modules/autonomy/workflows/decomposer/workflow.ts",
        defaultAutonomyMode: "autonomous",
        triggers: [],
        steps: [
          {
            id: "decompose",
            type: "agent",
            agentName: "decomposer",
            harness: "codex",
            effort: "xhigh",
          },
        ],
      },
    ];
    const result = await inspectAgent(ctx, "decomposer");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.agent.name).toBe("decomposer");
      expect(result.agent.writeScope).toEqual(["data/tasks/"]);
      expect(result.agent.sourcePaths).toEqual([
        "src/modules/autonomy",
        "p",
      ]);
      expect(result.agent.workflowUsages).toEqual([
        {
          workflow: "decomposer",
          stepId: "decompose",
          harness: "codex",
          autonomyMode: "autonomous",
          effort: "xhigh",
        },
      ]);
    }
  });
});
