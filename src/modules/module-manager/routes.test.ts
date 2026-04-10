import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ModuleSummary } from "../../core/modules/module-types.js";
import { handleListModules } from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => { result.status = s; },
    end: (data: string) => { result.body = JSON.parse(data); },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function makeSummary(overrides: Partial<ModuleSummary> = {}): ModuleSummary {
  return {
    name: "test-module",
    version: "1.0.0",
    description: "A test module",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: [],
    agentNames: [],
    agents: [],
    skills: [],
    commandNames: [],
    routeSummaries: [],
    ...overrides,
  };
}

describe("handleListModules", () => {
  it("returns 200 with empty modules array when none loaded", () => {
    const { res, result } = mockResponse();
    handleListModules(res, []);
    expect(result.status).toBe(200);
    const body = result.body as { modules: unknown[] };
    expect(body.modules).toEqual([]);
  });

  it("returns name, version, status, and contribution counts for each module", () => {
    const summary = makeSummary({
      name: "my-module",
      version: "2.1.0",
      toolNames: ["tool-a", "tool-b", "tool-c"],
      agentNames: ["agent-x"],
      workflowNames: ["wf-1", "wf-2"],
      skillNames: ["skill-1"],
      channelNames: [],
    });
    const { res, result } = mockResponse();
    handleListModules(res, [summary]);
    expect(result.status).toBe(200);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules).toHaveLength(1);
    const ext = body.modules[0];
    expect(ext.name).toBe("my-module");
    expect(ext.version).toBe("2.1.0");
    expect(ext.status).toBe("loaded");
    expect(ext.toolCount).toBe(3);
    expect(ext.agentCount).toBe(1);
    expect(ext.workflowCount).toBe(2);
    expect(ext.skillCount).toBe(1);
    expect(ext.channelCount).toBe(0);
  });

  it("handles module without version or description", () => {
    const summary = makeSummary({ name: "bare-module", version: undefined, description: undefined });
    const { res, result } = mockResponse();
    handleListModules(res, [summary]);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules[0].name).toBe("bare-module");
    expect(body.modules[0].version).toBeUndefined();
    expect(body.modules[0].description).toBeUndefined();
  });

  it("returns all loaded modules", () => {
    const summaries = [
      makeSummary({ name: "ext-a" }),
      makeSummary({ name: "ext-b" }),
      makeSummary({ name: "ext-c" }),
    ];
    const { res, result } = mockResponse();
    handleListModules(res, summaries);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules).toHaveLength(3);
    expect(body.modules.map((e) => e.name)).toEqual(["ext-a", "ext-b", "ext-c"]);
  });

  it("returns failed module with status failed and error field", () => {
    const failed = makeSummary({ name: "bad-ext", loadError: "it broke during onLoad" });
    const { res, result } = mockResponse();
    handleListModules(res, [failed]);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules).toHaveLength(1);
    const ext = body.modules[0];
    expect(ext.name).toBe("bad-ext");
    expect(ext.status).toBe("failed");
    expect(ext.error).toBe("it broke during onLoad");
    expect(ext.toolCount).toBe(0);
    expect(ext.agentCount).toBe(0);
  });

  it("includes both loaded and failed modules in the response", () => {
    const loaded = makeSummary({ name: "ok-ext", toolNames: ["tool-a"] });
    const failed = makeSummary({ name: "bad-ext", loadError: "crash" });
    const { res, result } = mockResponse();
    handleListModules(res, [loaded, failed]);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules).toHaveLength(2);
    const okExt = body.modules.find((e) => e.name === "ok-ext");
    const badExt = body.modules.find((e) => e.name === "bad-ext");
    expect(okExt?.status).toBe("loaded");
    expect(okExt?.toolCount).toBe(1);
    expect(badExt?.status).toBe("failed");
    expect(badExt?.error).toBe("crash");
  });
});
