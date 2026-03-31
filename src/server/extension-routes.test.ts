import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionSummary } from "../extension-types.js";
import { handleListExtensions } from "./extension-routes.js";

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

function makeSummary(overrides: Partial<ExtensionSummary> = {}): ExtensionSummary {
  return {
    name: "test-ext",
    version: "1.0.0",
    description: "A test extension",
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

describe("handleListExtensions", () => {
  it("returns 200 with empty extensions array when none loaded", () => {
    const { res, result } = mockResponse();
    handleListExtensions(res, []);
    expect(result.status).toBe(200);
    const body = result.body as { extensions: unknown[] };
    expect(body.extensions).toEqual([]);
  });

  it("returns name, version, status, and contribution counts for each extension", () => {
    const summary = makeSummary({
      name: "my-ext",
      version: "2.1.0",
      toolNames: ["tool-a", "tool-b", "tool-c"],
      agentNames: ["agent-x"],
      workflowNames: ["wf-1", "wf-2"],
      skillNames: ["skill-1"],
      channelNames: [],
    });
    const { res, result } = mockResponse();
    handleListExtensions(res, [summary]);
    expect(result.status).toBe(200);
    const body = result.body as { extensions: Array<Record<string, unknown>> };
    expect(body.extensions).toHaveLength(1);
    const ext = body.extensions[0];
    expect(ext.name).toBe("my-ext");
    expect(ext.version).toBe("2.1.0");
    expect(ext.status).toBe("loaded");
    expect(ext.toolCount).toBe(3);
    expect(ext.agentCount).toBe(1);
    expect(ext.workflowCount).toBe(2);
    expect(ext.skillCount).toBe(1);
    expect(ext.channelCount).toBe(0);
  });

  it("handles extension without version or description", () => {
    const summary = makeSummary({ name: "bare-ext", version: undefined, description: undefined });
    const { res, result } = mockResponse();
    handleListExtensions(res, [summary]);
    const body = result.body as { extensions: Array<Record<string, unknown>> };
    expect(body.extensions[0].name).toBe("bare-ext");
    expect(body.extensions[0].version).toBeUndefined();
    expect(body.extensions[0].description).toBeUndefined();
  });

  it("returns all loaded extensions", () => {
    const summaries = [
      makeSummary({ name: "ext-a" }),
      makeSummary({ name: "ext-b" }),
      makeSummary({ name: "ext-c" }),
    ];
    const { res, result } = mockResponse();
    handleListExtensions(res, summaries);
    const body = result.body as { extensions: Array<Record<string, unknown>> };
    expect(body.extensions).toHaveLength(3);
    expect(body.extensions.map((e) => e.name)).toEqual(["ext-a", "ext-b", "ext-c"]);
  });
});
