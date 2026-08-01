import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import {
  makeReloadSubject,
  mockModuleMetadata,
} from "./daemon-handle-test-support.integration.js";

vi.mock("#core/config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

vi.mock("#core/modules/module-metadata.js", () => ({
  loadModuleMetadata: vi.fn(),
}));

describe("buildDaemonHandle reloadConfig events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists setup statuses from manifest-backed module summaries", async () => {
    vi.mocked(loadConfig).mockReturnValue({});
    const setup = {
      mode: "form" as const,
      fields: [
        {
          id: "base-url",
          label: "Base URL",
          type: "string" as const,
          configPath: "modules.demo.baseUrl",
          required: true,
        },
      ],
    };
    const subject = makeReloadSubject({}, () => [
      {
        name: "demo",
        source: "project",
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
        setupRequirements: [
          {
            id: "endpoint",
            kind: "config",
            title: "Endpoint",
            required: true,
            scope: "project",
            sensitivity: "none",
            setup,
          },
        ],
        manifest: {
          schemaVersion: 1,
          moduleName: "demo",
          dependencies: [],
          capabilities: [
            {
              id: "demo.api",
              description: "Demo API.",
              scope: "external",
              scopePolicyHooks: ["setup"],
              setupRequirementIds: ["endpoint"],
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
            setupRequirements: [
              {
                id: "endpoint",
                kind: "config",
                setupMode: "form",
                sensitivity: "none",
                required: true,
                healthCapabilityIds: [],
                statusLinks: {
                  list: "/setup/requirements",
                  refresh: "/setup/requirements/demo/endpoint/refresh",
                  revoke: "/setup/requirements/demo/endpoint",
                  submitForm: "/setup/requirements/demo/endpoint/form",
                },
              },
            ],
          },
          effects: [],
          simulation: { support: "full", blockedReasons: [] },
          readiness: {
            setupRequirementIds: ["endpoint"],
            healthCapabilityIds: [],
            healthCheck: "not-declared",
          },
        },
      },
    ]);

    const result = await subject.handle.listModuleSetupStatuses();

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]).toMatchObject({
      moduleName: "demo",
      requirementId: "endpoint",
      state: "missing",
      reason: "config_missing",
    });
  });

  it("emits a typed successful config reload event with changed modules and workflow count", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({
      modules: { git: { token: "new" } },
    });
    const subject = makeReloadSubject({
      modules: { git: { token: "old" } },
    });

    const result = await subject.handle.reloadConfig();

    expect(result).toEqual({
      workflows: 5,
      changedModules: ["git", "github"],
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
    expect(subject.workflowRuntime.setWorkflowInputs).toHaveBeenCalledWith([
      { name: "builder", triggers: [], steps: [] },
    ]);
    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toMatchObject({
      scope: "daemon",
      outcome: "success",
      reloadKind: "module-scoped",
      fullReload: false,
      changedModules: ["git", "github"],
      workflowCount: 5,
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
    expect(subject.events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits a no-op reload event when config produces no changed modules", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({});
    const subject = makeReloadSubject({});

    await subject.handle.reloadConfig();

    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toMatchObject({
      outcome: "success",
      reloadKind: "noop",
      fullReload: false,
      changedModules: [],
      workflowCount: 5,
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
  });

  it("reports serve-owned sessions as non-refreshable on reload", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({
      guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
    });
    const subject = makeReloadSubject({});
    subject.handle.registerSession("serve-1", "2026-01-01T00:00:00.000Z", "supervised");

    const result = await subject.handle.reloadConfig();

    expect(subject.refreshLiveSessionGuardrails).toHaveBeenCalledWith({
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    });
    expect(result.sessionGuardrails).toEqual({
      refreshed: 0,
      unchanged: 0,
      nonRefreshable: [
        { id: "serve-1", source: "serve", reason: "serve-owned-session" },
      ],
    });
    expect(subject.events[0]).toMatchObject({
      sessionGuardrails: result.sessionGuardrails,
    });
  });

  it("emits a sanitized failure event before rethrowing reload errors", async () => {
    vi.mocked(loadConfig).mockImplementation(() => {
      throw new Error("raw secret token should not leave the caller");
    });
    const subject = makeReloadSubject({});

    await expect(subject.handle.reloadConfig()).rejects.toThrow("raw secret token");

    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      scope: "daemon",
      outcome: "failure",
      reloadKind: "failed",
      fullReload: false,
      changedModules: [],
      workflowCount: 3,
      errorClass: "Error",
      errorMessage: "Config reload failed",
    });
  });
});
