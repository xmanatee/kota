import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import { agentControlRoutes } from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function makeRequest(): IncomingMessage {
  return {} as IncomingMessage;
}

function makeSummary(): ModuleSummary {
  return {
    name: "autonomy",
    source: "bundled",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: [],
    agentNames: ["builder"],
    agents: [
      {
        name: "builder",
        role: "implements normalized tasks",
        promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
        model: "claude-opus-4-7",
        effort: "xhigh",
        writeScope: [],
      },
    ],
    skills: [],
    commandNames: [],
    routeSummaries: [],
  };
}

function makeContext(): ModuleContext {
  return {
    cwd: "/tmp/kota",
    config: {},
    getModuleSummaries: () => [makeSummary()],
    getContributedWorkflows: () => [],
  } as unknown as ModuleContext;
}

describe("agentControlRoutes", () => {
  it("registers read-only list and inspect routes", () => {
    const routes = agentControlRoutes(makeContext());
    expect(routes.map((route) => ({
      method: route.method,
      path: route.path,
      capabilityScope: route.capabilityScope,
    }))).toEqual([
      { method: "GET", path: "/agents", capabilityScope: "read" },
      { method: "GET", path: "/agents/:name", capabilityScope: "read" },
    ]);
  });

  it("returns the shared listAgents payload from the list route", async () => {
    const [route] = agentControlRoutes(makeContext());
    const { res, result } = mockResponse();
    await route.handler(makeRequest(), res, {});
    expect(result.status).toBe(200);
    const body = result.body as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      name: "builder",
      source: "autonomy",
      moduleSource: "bundled",
      toolPolicy: { posture: "inherits-session" },
    });
  });

  it("returns the shared typed inspect payload from the inspect route", async () => {
    const [, route] = agentControlRoutes(makeContext());
    const found = mockResponse();
    await route.handler(makeRequest(), found.res, { name: "builder" });
    expect(found.result.status).toBe(200);
    expect(found.result.body).toMatchObject({
      found: true,
      agent: { name: "builder", source: "autonomy" },
    });

    const missing = mockResponse();
    await route.handler(makeRequest(), missing.res, { name: "missing" });
    expect(missing.result.status).toBe(200);
    expect(missing.result.body).toEqual({ found: false });
  });
});
