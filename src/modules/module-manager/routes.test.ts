import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { ModuleSetupRequirementStatus } from "#core/modules/setup-requirements.js";
import { buildModuleListEntries, handleListModules } from "./routes.js";

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
    source: "bundled",
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

function makeManifest(): NonNullable<ModuleSummary["manifest"]> {
  return {
    schemaVersion: 1,
    moduleName: "test-module",
    dependencies: [],
    capabilities: [
      {
        id: "test-module.capability",
        description: "Test capability.",
        scope: "daemon",
        scopePolicyHooks: [],
      },
    ],
    dataClasses: [],
    contributions: {
      tools: [],
      workflows: [],
      workflowTriggers: [],
      channels: [],
      skills: [],
      agents: [],
      commands: [],
      routes: [],
      controlRoutes: [],
      events: [],
      eventFlows: [],
      clients: { localNamespaces: [], daemonFactory: false },
      setupRequirements: [],
    },
    effects: [],
    simulation: { support: "full", blockedReasons: [] },
    readiness: {
      setupRequirementIds: [],
      healthCapabilityIds: [],
      healthCheck: "not-declared",
    },
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

  it("exposes manifest projections on daemon and client list shapes", () => {
    const manifest = makeManifest();
    const summary = makeSummary({ name: "manifest-module", manifest });
    const { res, result } = mockResponse();

    handleListModules(res, [summary]);
    const body = result.body as { modules: Array<Record<string, unknown>> };
    expect(body.modules[0].manifest).toEqual(manifest);

    const entries = buildModuleListEntries([summary]);
    expect(entries[0].manifest).toEqual(manifest);
  });

  it("scopes setup availability onto manifest projections for daemon and client list shapes", () => {
    const manifest = makeManifest();
    const manifestWithSetup: NonNullable<ModuleSummary["manifest"]> = {
      ...manifest,
      capabilities: [
        {
          ...manifest.capabilities[0],
          setupRequirementIds: ["api-token"],
        },
      ],
      contributions: {
        ...manifest.contributions,
        setupRequirements: [
          {
            id: "api-token",
            kind: "secret",
            setupMode: "url",
            sensitivity: "secret",
            required: true,
            healthCapabilityIds: ["test-module.capability"],
            statusLinks: {
              list: "/setup/requirements",
              refresh: "/setup/requirements/test-module/api-token/refresh",
              revoke: "/setup/requirements/test-module/api-token",
              storeSecret: "/setup/requirements/test-module/api-token/secret",
              start: "/setup/requirements/test-module/api-token/start",
            },
          },
        ],
      },
      readiness: {
        setupRequirementIds: ["api-token"],
        healthCapabilityIds: ["test-module.capability"],
        healthCheck: "not-declared",
      },
    };
    const setup = {
      mode: "url" as const,
      url: "https://auth.example.test/start",
      label: "Open auth",
    };
    const summary = makeSummary({
      manifest: manifestWithSetup,
      setupRequirements: [
        {
          id: "api-token",
          kind: "secret",
          title: "API token",
          required: true,
          scope: "scope",
          sensitivity: "secret",
          health: { capabilityIds: ["test-module.capability"] },
          setup,
          secretRefs: [{ name: "TEST_MODULE_TOKEN", scope: "scope" }],
        },
      ],
    });
    const status: ModuleSetupRequirementStatus = {
      moduleName: "test-module",
      requirementId: "api-token",
      kind: "secret",
      title: "API token",
      required: true,
      scope: "scope",
      sensitivity: "secret",
      setup,
      state: "unavailable",
      reason: "capability_unavailable",
      message: "Capability is unavailable",
      capabilities: [
        {
          id: "test-module.capability",
          status: "unavailable",
          reason: "auth_missing",
        },
      ],
    };
    const { res, result } = mockResponse();

    handleListModules(res, [summary], [status]);

    const body = result.body as { modules: Array<{ manifest?: NonNullable<ModuleSummary["manifest"]> }> };
    expect(body.modules[0].manifest?.contributions.setupRequirements[0]?.availability)
      .toMatchObject({
        state: "unavailable",
        reason: "capability_unavailable",
        capabilities: [
          {
            id: "test-module.capability",
            status: "unavailable",
            reason: "auth_missing",
          },
        ],
      });

    const entries = buildModuleListEntries([summary], [status]);
    expect(entries[0].manifest?.contributions.setupRequirements[0]?.availability)
      .toMatchObject({
        state: "unavailable",
        reason: "capability_unavailable",
      });
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
