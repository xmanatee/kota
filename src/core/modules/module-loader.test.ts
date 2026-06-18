import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listHarnessHooks,
  resetHarnessHooks,
} from "#core/agent-harness/hooks.js";
import { clearRegisteredConfigSlices, type ModuleConfigSlice } from "#core/config/config-slice.js";
import type { UiSurface } from "#core/daemon/ui-surface.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  collectDynamicState,
  resetDynamicStateProviders,
} from "#core/loop/dynamic-state.js";
import { NullTransport } from "#core/loop/transport.js";
import {
  legacyEffect,
  networkWriteEffect,
  operatorSurfaceEffect,
} from "#core/tools/effect.js";
import { clearCustomTools, executeTool, getAllTools } from "#core/tools/index.js";
import { clearCustomGroups, enableGroup, filterTools, resetGroups, TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { ModuleLoader } from "./module-loader.js";
import { projectSetupStatusOntoManifest } from "./module-manifest.js";
import type { KotaModule } from "./module-types.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "./provider-registry.js";
import type { RenderingProvider, ReplChrome } from "./provider-types.js";

function fakeSlice(key: string, description = "test"): ModuleConfigSlice {
  return {
    key: key as never,
    description,
    sanitize: (raw) => (typeof raw === "object" && raw !== null ? raw : undefined) as never,
    merge: (base, override) => ({ ...(base as object), ...(override as object) }) as never,
    projectConfigSafety: "authority",
    schemaSource: { relativePath: "test", typeName: "TestConfig" },
  };
}

function makeTool(name: string, opts?: { risk?: "safe" | "moderate" | "dangerous"; kind?: "discovery" | "action" }) {
  return {
    tool: {
      name,
      description: `Test tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    runner: async () => ({ content: `result from ${name}` }),
    effect: legacyEffect({
      risk: opts?.risk ?? "safe",
      kind: opts?.kind ?? "discovery",
    }),
  };
}

function makeToolWithoutMeta(name: string) {
  return {
    tool: {
      name,
      description: `Test tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    runner: async () => ({ content: `result from ${name}` }),
  };
}

const noopChrome: ReplChrome = {
  announceHarness: () => {},
  showHelp: () => {},
  showStatus: () => {},
  showReset: () => {},
  showError: () => {},
  showGoodbye: () => {},
};

function installRenderingCapture(chunks: string[]): void {
  const provider: RenderingProvider = {
    createAgentTransport: () => new NullTransport(),
    createReplChrome: () => noopChrome,
    printDiagnostic: (diagnostic) => {
      chunks.push(diagnostic.detail ? `${diagnostic.message}\n${diagnostic.detail}` : diagnostic.message);
    },
    printPrompt: (prompt) => {
      chunks.push(prompt.kind);
    },
    writeStderr: (text) => {
      chunks.push(text);
    },
  };
  initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "test", provider);
}

describe("ModuleLoader", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetProviderRegistry();
    resetDynamicStateProviders();
    resetHarnessHooks();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetProviderRegistry();
    resetDynamicStateProviders();
    resetHarnessHooks();
  });

  it("loads a module with tools", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "test-mod",
      tools: [makeTool("test_tool")],
    };

    await loader.load(mod);
    expect(loader.getLoadedModules()).toEqual(["test-mod"]);
    expect(loader.getModuleCount()).toBe(1);
    expect(loader.getToolCount()).toBe(1);

    const result = await executeTool("test_tool", {});
    expect(result.content).toBe("result from test_tool");
  });

  it("registers tools into groups via group field", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "grouped-mod",
      tools: [{ ...makeTool("grouped_tool"), group: "test_group" }],
    };

    await loader.load(mod);
    expect(TOOL_GROUPS.test_group).toContain("grouped_tool");

    // Tool hidden until group enabled
    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "grouped_tool")).toBe(false);

    enableGroup("test_group");
    const after = filterTools(getAllTools());
    expect(after.some((t) => t.name === "grouped_tool")).toBe(true);
  });

  it("rejects a tool missing effect metadata", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "no-effect-mod",
      tools: [makeToolWithoutMeta("no_effect_tool") as any],
    };

    await expect(loader.load(mod)).rejects.toThrow("missing required metadata: effect");
  });

  it("loads a tool with complete metadata", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "annotated-mod",
      tools: [makeTool("annotated_tool")],
    };

    await loader.load(mod);
    expect(loader.getToolCount()).toBe(1);
  });

  it("projects a module capability manifest from cached contributions and tool effects", async () => {
    const loader = new ModuleLoader({});
    const { Command } = await import("commander");

    await loader.load({ name: "base-mod" });
    await loader.load({
      name: "manifest-mod",
      dependencies: ["base-mod"],
      tools: [
        {
          ...makeTool("send_payload"),
          effect: networkWriteEffect(),
        },
      ],
      effects: [
        {
          id: "manifest-mod.notify",
          description: "Notify the operator about a fixture payload.",
          source: "notification",
          effect: operatorSurfaceEffect(),
          capabilityIds: ["manifest-mod.api"],
        },
      ],
      setupRequirements: [
        {
          id: "api-credential",
          kind: "secret",
          title: "API credential",
          required: true,
          scope: "project",
          owner: "manifest-mod",
          sensitivity: "secret",
          health: { capabilityIds: ["manifest-mod.api"] },
          setup: {
            mode: "url",
            url: "https://example.invalid/settings",
            label: "Open settings",
          },
          secretRefs: [{ name: "MANIFEST_MOD_TOKEN", scope: "project" }],
        },
      ],
      routes: () => [{ method: "GET", path: "/api/manifest", handler: () => undefined }],
      controlRoutes: () => [
        {
          method: "GET",
          path: "/manifest",
          capabilityScope: "read",
          handler: () => undefined,
        },
      ],
      workflows: [
        {
          name: "manifest-mod/workflow",
          triggers: [{ event: "manifest.event", cooldownMs: 1000 }],
          steps: [
            { id: "noop", type: "code", run: () => {} },
            { id: "emit-done", type: "emit", event: "manifest.done" },
          ],
        },
      ],
      channels: [
        {
          name: "manifest-mod.channel",
          description: "test",
          create: () => ({ status: "disabled", reason: "test fixture" }),
        },
      ],
      commands: () => [new Command("manifest-command")],
      manifest: {
        schemaVersion: 1,
        capabilities: [
          {
            id: "manifest-mod.api",
            description: "Send payloads through the manifest fixture API.",
            scope: "external",
            scopePolicyHooks: ["external-effects", "setup"],
            setupRequirementIds: ["api-credential"],
            readinessIds: ["manifest-mod.api"],
          },
        ],
        dataClasses: [
          {
            id: "manifest-mod.credential",
            description: "Fixture credential reference.",
            sensitivity: "credential",
            retention: "project-durable",
            redaction: "mask-secret",
          },
        ],
        simulation: {
          support: "external-effects-blocked",
          blockedReasons: ["Fixture API sends are blocked in trial mode."],
        },
      },
    });

    const summary = loader
      .getModuleSummaries()
      .find((candidate) => candidate.name === "manifest-mod");
    const manifest = summary?.manifest;
    expect(manifest?.capabilities.map((capability) => capability.id)).toEqual([
      "manifest-mod.api",
    ]);
    expect(manifest?.contributions).toMatchObject({
      tools: ["send_payload"],
      workflows: ["manifest-mod/workflow"],
      workflowTriggers: ["event:manifest.event"],
      channels: ["manifest-mod.channel"],
      commands: ["manifest-command"],
      routes: ["GET /api/manifest"],
      controlRoutes: ["GET /manifest"],
      eventFlows: [
        {
          name: "manifest.done",
          declared: false,
          producers: [
            { workflow: "manifest-mod/workflow", stepId: "emit-done" },
          ],
          consumers: [],
        },
        {
          name: "manifest.event",
          declared: false,
          producers: [],
          consumers: [
            { workflow: "manifest-mod/workflow", source: "trigger" },
          ],
        },
      ],
      setupRequirements: [
        expect.objectContaining({
          id: "api-credential",
          setupMode: "url",
          sensitivity: "secret",
          healthCapabilityIds: ["manifest-mod.api"],
          statusLinks: {
            list: "/setup/requirements",
            refresh: "/setup/requirements/manifest-mod/api-credential/refresh",
            revoke: "/setup/requirements/manifest-mod/api-credential",
            storeSecret: "/setup/requirements/manifest-mod/api-credential/secret",
            start: "/setup/requirements/manifest-mod/api-credential/start",
          },
        }),
      ],
    });
    expect(manifest?.readiness).toEqual({
      setupRequirementIds: ["api-credential"],
      healthCapabilityIds: ["manifest-mod.api"],
      healthCheck: "not-declared",
    });
    expect(manifest?.effects).toEqual([
      expect.objectContaining({
        id: "tool.send_payload",
        risk: "moderate",
        categories: ["external-write"],
      }),
      expect.objectContaining({
        id: "manifest-mod.notify",
        categories: ["notification", "owner-visible"],
      }),
    ]);
    expect(JSON.stringify(manifest)).not.toContain("secretRefs");
    expect(JSON.stringify(manifest)).not.toContain("MANIFEST_MOD_TOKEN");

    if (!manifest) throw new Error("manifest projection missing");
    const withSetupStatus = projectSetupStatusOntoManifest(manifest, [
      {
        moduleName: "manifest-mod",
        requirementId: "api-credential",
        kind: "secret",
        title: "API credential",
        required: true,
        scope: "project",
        sensitivity: "secret",
        setup: {
          mode: "url",
          url: "https://example.invalid/settings",
          label: "Open settings",
        },
        state: "pending",
        reason: "url_setup_pending",
        message: "Setup URL action is pending",
        pendingAction: {
          actionId: "manifest-mod.api-credential.1",
          moduleName: "manifest-mod",
          requirementId: "api-credential",
          url: "https://example.invalid/settings",
          label: "Open settings",
          status: "pending",
          createdAt: "2026-06-13T00:00:00.000Z",
          expiresAt: "2026-06-13T00:10:00.000Z",
        },
      },
    ]);
    expect(withSetupStatus.contributions.setupRequirements[0]?.availability).toMatchObject({
      state: "pending",
      reason: "url_setup_pending",
      pendingAction: {
        actionId: "manifest-mod.api-credential.1",
        complete: "/setup/actions/manifest-mod.api-credential.1/complete",
      },
    });
  });

  it("rejects manifest effects that reference unknown capability ids", async () => {
    const loader = new ModuleLoader({});

    await expect(
      loader.load({
        name: "bad-manifest-mod",
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-manifest-mod.api",
              description: "Fixture capability.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [],
          additionalEffects: [
            {
              id: "bad-manifest-mod.send",
              description: "Fixture external send.",
              source: "tool",
              effect: networkWriteEffect(),
              capabilityIds: ["missing.capability"],
            },
          ],
          simulation: {
            support: "external-effects-blocked",
            blockedReasons: ["Fixture sends are blocked."],
          },
        },
      }),
    ).rejects.toThrow(/references unknown capability id "missing.capability"/);
  });

  it("rejects malformed manifest enum values and effect shapes at runtime", async () => {
    await expect(
      new ModuleLoader({}).load({
        name: "bad-scope-manifest",
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-scope.api",
              description: "Fixture capability.",
              scope: "workspace",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [],
          simulation: { support: "full", blockedReasons: [] },
        } as unknown as KotaModule["manifest"],
      }),
    ).rejects.toThrow(/capability "bad-scope.api" scope has unknown value "workspace"/);

    await expect(
      new ModuleLoader({}).load({
        name: "bad-data-manifest",
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-data.api",
              description: "Fixture capability.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [
            {
              id: "bad-data.payload",
              description: "Fixture payload.",
              sensitivity: "raw-token",
              retention: "forever",
              redaction: "print-secret",
            },
          ],
          simulation: { support: "full", blockedReasons: [] },
        } as unknown as KotaModule["manifest"],
      }),
    ).rejects.toThrow(/data class "bad-data.payload" sensitivity has unknown value "raw-token"/);

    await expect(
      new ModuleLoader({}).load({
        name: "bad-effect-manifest",
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-effect.api",
              description: "Fixture capability.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [],
          additionalEffects: [
            {
              id: "bad-effect.send",
              description: "Fixture send.",
              source: "notification",
              effect: {
                kind: "write",
                scope: "operator",
                idempotent: "no",
                openWorld: false,
              },
              capabilityIds: ["bad-effect.api"],
            },
          ],
          simulation: {
            support: "external-effects-blocked",
            blockedReasons: ["Fixture sends are blocked."],
          },
        } as unknown as KotaModule["manifest"],
      }),
    ).rejects.toThrow(/effect "bad-effect.send" tool effect scope has unknown value "operator"/);

    await expect(
      new ModuleLoader({}).load({
        name: "bad-simulation-manifest",
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-simulation.api",
              description: "Fixture capability.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [],
          simulation: { support: "sometimes", blockedReasons: [] },
        } as unknown as KotaModule["manifest"],
      }),
    ).rejects.toThrow(/simulation support has unknown value "sometimes"/);
  });

  it("rejects external or operator-visible effects without explicit manifest coverage", async () => {
    await expect(
      new ModuleLoader({}).load({
        name: "uncovered-external",
        tools: [
          {
            ...makeTool("uncovered_send"),
            effect: networkWriteEffect(),
          },
        ],
      }),
    ).rejects.toThrow(/must declare a manifest.*tool\.uncovered_send/);

    const result = await executeTool("uncovered_send", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  it("rejects non-tool notification effects without explicit manifest coverage", async () => {
    await expect(
      new ModuleLoader({}).load({
        name: "uncovered-notifier",
        channels: [
          {
            name: "uncovered-notifier.channel",
            description: "Fixture notification channel",
            create: () => ({ status: "disabled", reason: "test fixture" }),
          },
        ],
        effects: [
          {
            id: "uncovered-notifier.delivery",
            description: "Deliver a fixture notification to the operator.",
            source: "notification",
            effect: operatorSurfaceEffect(),
          },
        ],
      }),
    ).rejects.toThrow(/must declare a manifest.*uncovered-notifier\.delivery/);
  });

  it("does not expose skipped installed module tools after manifest validation fails", async () => {
    const loader = new ModuleLoader({});

    await loader.loadAll(
      [{ name: "good-mod" }],
      [
        {
          name: "bad-installed-manifest",
          tools: [
            {
              ...makeTool("skipped_external_send"),
              effect: networkWriteEffect(),
            },
          ],
          workflows: [
            {
              name: "bad-installed-manifest/workflow",
              triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
              steps: [{ id: "noop", type: "code", run: () => {} }],
            },
          ],
        },
      ],
    );

    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(loader.getToolCount()).toBe(0);
    expect(loader.getContributedWorkflows()).toEqual([]);
    const result = await executeTool("skipped_external_send", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");

    const failedSummary = loader
      .getModuleSummaries()
      .find((summary) => summary.name === "bad-installed-manifest");
    expect(failedSummary?.source).toBe("installed");
    expect(failedSummary?.loadError).toMatch(/must declare a manifest/);
  });

  it("rejects explicit manifests that omit simulation blocking for projected effects", async () => {
    await expect(
      new ModuleLoader({}).load({
        name: "bad-simulation-coverage",
        tools: [
          {
            ...makeTool("send_without_blocking"),
            effect: networkWriteEffect(),
          },
        ],
        manifest: {
          schemaVersion: 1,
          capabilities: [
            {
              id: "bad-simulation-coverage.api",
              description: "Fixture capability.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [
            {
              id: "bad-simulation-coverage.payload",
              description: "Fixture payload.",
              sensitivity: "provider-payload",
              retention: "run-artifact",
              redaction: "metadata-only",
            },
          ],
          simulation: { support: "full", blockedReasons: [] },
        },
      }),
    ).rejects.toThrow(/simulation support "full" conflicts with blocked effects: tool\.send_without_blocking/);
  });

  it("rejects duplicate module names", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "dup" });
    await expect(loader.load({ name: "dup" })).rejects.toThrow(
      'Duplicate module name: "dup"',
    );
  });

  it("rejects modules with missing dependencies", async () => {
    const loader = new ModuleLoader({});
    const mod: KotaModule = {
      name: "dependent",
      dependencies: ["missing-dep"],
    };
    await expect(loader.load(mod)).rejects.toThrow(
      'Module "dependent" requires "missing-dep" which is not loaded',
    );
  });

  it("loads dependencies before dependents via loadAll", async () => {
    const loader = new ModuleLoader({});
    const loadOrder: string[] = [];

    const dep: KotaModule = {
      name: "base",
      onLoad: () => { loadOrder.push("base"); },
    };
    const dependent: KotaModule = {
      name: "ext",
      dependencies: ["base"],
      onLoad: () => { loadOrder.push("ext"); },
    };

    // Intentionally pass in wrong order
    await loader.loadAll([dependent, dep]);
    expect(loadOrder).toEqual(["base", "ext"]);
    expect(loader.getLoadedModules()).toEqual(["base", "ext"]);
  });

  it("calls onLoad with ModuleContext including getRoutes", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({ model: "test-model" }, true);
    await loader.load({ name: "ctx-test", onLoad });

    expect(onLoad).toHaveBeenCalledOnce();
    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.cwd).toBeTruthy();
    expect(typeof ctx.verbose).toBe("boolean");
    expect(typeof ctx.registerGroup).toBe("function");
    expect(typeof ctx.getRoutes).toBe("function");
    expect(ctx.config).toEqual({ model: "test-model" });
  });

  it("getRoutes in context returns routes from all loaded modules", async () => {
    const handler = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "route-provider",
      routes: () => [{ method: "POST", path: "/api/test", handler }],
    });

    // A module's commands() can use ctx.getRoutes() to discover routes
    let discoveredRoutes: any[] = [];
    const { Command } = await import("commander");
    await loader.load({
      name: "route-consumer",
      commands: (ctx) => {
        discoveredRoutes = ctx.getRoutes();
        return [new Command("test-cmd")];
      },
    });

    expect(discoveredRoutes).toHaveLength(1);
    expect(discoveredRoutes[0].path).toBe("/api/test");
  });

  it("collects workflow definitions from modules and exposes via getContributedWorkflows", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "workflow-provider",
      workflows: [
        {
          name: "workflow-provider/my-job",
          triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
          steps: [{ id: "noop", type: "code", run: () => {} }],
        },
      ],
    });

    const workflows = loader.getContributedWorkflows();
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("workflow-provider/my-job");
    expect(workflows[0].definitionPath).toBe("modules/workflow-provider");
  });

  it("collects channel definitions from modules and exposes via getContributedChannels", async () => {
    const loader = new ModuleLoader({});
    const mockCreate = () =>
      ({ status: "disabled", reason: "test stub" }) as const;

    await loader.load({
      name: "channel-provider",
      channels: [{ name: "test-channel", description: "A test channel", create: mockCreate }],
    });

    const channels = loader.getContributedChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("test-channel");
  });

  it("collects UI surfaces from modules and validates global extension ids", async () => {
    const loader = new ModuleLoader({});
    const surface = {
      protocolVersion: "ui.surface.v1" as const,
      surfaceId: "demo",
      extensionId: "demo.surface",
      title: "Demo",
      intent: "Work" as const,
      scopeId: "scope-a",
      attachmentPoint: { kind: "root" as const },
      order: 10,
      nodes: [],
      actions: [],
    };

    await loader.load({
      name: "ui-provider",
      uiSurfaces: [surface],
    });

    expect(loader.getContributedUiSurfaces()).toEqual([surface]);
    await expect(
      loader.load({
        name: "bad-ui-provider",
        uiSurfaces: [
          {
            ...surface,
            surfaceId: "other-demo",
          },
        ],
      }),
    ).rejects.toThrow(/duplicate extensionId "demo.surface"/);
  });

  it("rejects module-contributed UI surfaces with invalid runtime discriminants", async () => {
    const loader = new ModuleLoader({});
    const surface = {
      protocolVersion: "ui.surface.v1" as const,
      surfaceId: "demo",
      extensionId: "demo.surface",
      title: "Demo",
      intent: "Work" as const,
      scopeId: "scope-a",
      attachmentPoint: { kind: "root" as const },
      order: 10,
      nodes: [{ kind: "timeline" } as unknown as UiSurface["nodes"][number]],
      actions: [],
    };

    await expect(
      loader.load({
        name: "bad-ui-provider",
        uiSurfaces: [surface],
      }),
    ).rejects.toThrow(/node timeline\.kind "timeline" must be one of/);
  });

  it("exposes contributed workflows via ctx.getContributedWorkflows()", async () => {
    const loader = new ModuleLoader({});

    await loader.load({
      name: "wf-ext",
      workflows: [
        {
          name: "wf-ext/heartbeat",
          triggers: [{ intervalMs: 300_000 }],
          steps: [{ id: "noop", type: "code", run: () => {} }],
        },
      ],
    });

    let discoveredWorkflows: any[] = [];
    await loader.load({
      name: "wf-consumer",
      onLoad: (ctx) => {
        discoveredWorkflows = ctx.getContributedWorkflows();
      },
    });

    expect(discoveredWorkflows).toHaveLength(1);
    expect(discoveredWorkflows[0].name).toBe("wf-ext/heartbeat");
  });

  it("calls onUnload in reverse order during unloadAll", async () => {
    const unloadOrder: string[] = [];
    const loader = new ModuleLoader({});

    await loader.loadAll([
      { name: "first", onUnload: () => { unloadOrder.push("first"); } },
      { name: "second", onUnload: () => { unloadOrder.push("second"); } },
      { name: "third", onUnload: () => { unloadOrder.push("third"); } },
    ]);

    await loader.unloadAll();
    expect(unloadOrder).toEqual(["third", "second", "first"]);
    expect(loader.getModuleCount()).toBe(0);
  });

  it("cleans up tools on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cleanup-mod",
      tools: [makeTool("cleanup_tool")],
    });

    const result1 = await executeTool("cleanup_tool", {});
    expect(result1.content).toBe("result from cleanup_tool");

    await loader.unloadAll();
    const result2 = await executeTool("cleanup_tool", {});
    expect(result2.is_error).toBe(true);
  });

  it("collects CLI commands from modules", async () => {
    const { Command } = await import("commander");
    const loader = new ModuleLoader({});

    await loader.load({
      name: "cmd-mod",
      commands: () => [
        new Command("test-cmd").description("A test command"),
      ],
    });

    const commands = loader.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name()).toBe("test-cmd");
  });

  it("collects HTTP routes from modules", async () => {
    const handler = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "route-mod",
      routes: () => [
        { method: "GET", path: "/api/test", handler },
        { method: "POST", path: "/api/test", handler },
      ],
    });

    const routes = loader.getRoutes();
    expect(routes).toHaveLength(2);
    expect(routes[0]).toEqual({ method: "GET", path: "/api/test", handler });
  });

  it("project module load failure throws from loadAll", async () => {
    const loader = new ModuleLoader({});
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    await expect(
      loader.loadAll([
        {
          name: "bad-mod",
          onLoad: () => { throw new Error("boom"); },
        },
        { name: "good-mod" },
      ]),
    ).rejects.toThrow("1 project module(s) failed to load");

    // Good module still loaded despite the throw
    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Module "bad-mod" failed to load: boom'),
      ]),
    );
  });

  it("installed module load failure is non-fatal in loadAll", async () => {
    const loader = new ModuleLoader({});
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("missing creds"); },
      }],
    );

    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(chunks).not.toEqual(
      expect.arrayContaining([expect.stringContaining("bad-installed")]),
    );
  });

  it("installed module load failure logs in verbose mode", async () => {
    const loader = new ModuleLoader({}, true);
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("missing creds"); },
      }],
    );

    expect(loader.getLoadedModules()).toEqual(["good-mod"]);
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Optional module "bad-installed" skipped'),
      ]),
    );
  });

  it("records load failures with source in getModuleSummaries", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loader.loadAll(
      [{ name: "good-mod" }],
      [{
        name: "bad-installed",
        onLoad: () => { throw new Error("it broke"); },
      }],
    );

    const summaries = loader.getModuleSummaries();
    const goodSummary = summaries.find((s) => s.name === "good-mod");
    const badSummary = summaries.find((s) => s.name === "bad-installed");

    expect(goodSummary).toBeDefined();
    expect(goodSummary?.loadError).toBeUndefined();
    expect(goodSummary?.source).toBe("project");

    expect(badSummary).toBeDefined();
    expect(badSummary?.loadError).toBe("it broke");
    expect(badSummary?.source).toBe("installed");
    expect(badSummary?.toolNames).toEqual([]);

    errSpy.mockRestore();
  });

  it("\"commands\" mode skips tool registration and onLoad", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false, { mode: "commands" });
    const { Command } = await import("commander");

    await loader.load({
      name: "cmd-only-mod",
      tools: [makeTool("should_not_register")],
      onLoad,
      commands: () => [new Command("my-cmd").description("test")],
    });

    // Module is loaded (tracked)
    expect(loader.getLoadedModules()).toEqual(["cmd-only-mod"]);
    // The loader exposes its lifecycle mode
    expect(loader.getMode()).toBe("commands");
    // But tools are NOT registered
    expect(loader.getToolCount()).toBe(0);
    const result = await executeTool("should_not_register", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
    // And onLoad was NOT called
    expect(onLoad).not.toHaveBeenCalled();
    // Commands still work
    const cmds = loader.getCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("my-cmd");
  });

  it("\"commands\" mode rejects route/control-route/health-check accessors but exposes static contributions", async () => {
    const loader = new ModuleLoader({}, false, { mode: "commands" });

    // Load a module that contributes routes, control routes, workflows, channels,
    // agents, and a health check. Routes/control-routes/health-checks depend on
    // onLoad-driven provider state and must throw in commands mode; the static
    // contributions remain readable from definitions.
    await loader.load({
      name: "everything-mod",
      routes: () => [{ method: "GET", path: "/x", handler: () => undefined }],
      controlRoutes: () => [
        {
          method: "GET",
          path: "/control/y",
          capabilityScope: "read",
          handler: async () => undefined,
        },
      ],
      workflows: [
        {
          name: "everything-mod/workflow",
          triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
          steps: [{ id: "noop", type: "code", run: () => {} }],
        },
      ],
      channels: [{ name: "everything-mod.chan", description: "x", create: () => null } as never],
      agents: [{ name: "everything-mod.agent", role: "test", skills: [] } as never],
      healthCheck: () => ({ status: "healthy" }),
    });

    expect(() => loader.getRoutes()).toThrow(/lifecycle mode "runtime"/);
    expect(() => loader.getContributedControlRoutes()).toThrow(/lifecycle mode "runtime"/);
    await expect(loader.probeHealthChecks()).rejects.toThrow(/lifecycle mode "runtime"/);

    // Static-data accessors remain safe — they are populated from the module
    // definition during load() regardless of mode.
    expect(loader.getContributedWorkflows()).toHaveLength(1);
    expect(loader.getContributedWorkflows()[0].name).toBe("everything-mod/workflow");
    expect(loader.getContributedChannels()).toHaveLength(1);
    expect(loader.getContributedChannels()[0].name).toBe("everything-mod.chan");
    expect(loader.getAgentDef("everything-mod.agent")?.name).toBe("everything-mod.agent");
    // No skill files registered in this fixture, so the prompt is empty —
    // not a silent partial, just an empty contribution set.
    expect(loader.getSkillsPrompt()).toBe("");

    // Commands and module summaries remain readable in commands mode.
    expect(loader.getCommands()).toEqual([]);
    expect(loader.getModuleSummaries().map((s) => s.name)).toEqual(["everything-mod"]);
  });

  it("runtime mode permits every runtime-only contribution getter", async () => {
    const loader = new ModuleLoader({}, false, { mode: "runtime" });

    await loader.load({
      name: "runtime-mod",
      routes: () => [{ method: "GET", path: "/x", handler: () => undefined }],
    });

    expect(loader.getMode()).toBe("runtime");
    expect(() => loader.getRoutes()).not.toThrow();
    expect(loader.getRoutes()).toHaveLength(1);
    expect(() => loader.getContributedControlRoutes()).not.toThrow();
    expect(() => loader.getContributedWorkflows()).not.toThrow();
    expect(() => loader.getContributedChannels()).not.toThrow();
    expect(() => loader.getSkillsPrompt()).not.toThrow();
    expect(() => loader.getAgentDef("nope")).not.toThrow();
    await expect(loader.probeHealthChecks()).resolves.toBeDefined();
  });

  it("handles onUnload errors gracefully", async () => {
    const loader = new ModuleLoader({});
    const chunks: string[] = [];
    installRenderingCapture(chunks);

    await loader.load({
      name: "bad-unload",
      onUnload: () => { throw new Error("cleanup failed"); },
    });

    await loader.unloadAll();
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Module "bad-unload" unload error: cleanup failed'),
      ]),
    );
  });

  it("unloads a single module and deregisters its tools", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      tools: [makeTool("tool_a")],
    });
    await loader.load({ name: "mod-b", tools: [makeTool("tool_b")] });

    expect(loader.getLoadedModules()).toEqual(["mod-a", "mod-b"]);

    // tool_a works before unload
    const r1 = await executeTool("tool_a", {});
    expect(r1.content).toBe("result from tool_a");

    await loader.unload("mod-a");
    expect(loader.getLoadedModules()).toEqual(["mod-b"]);

    // tool_a gone, tool_b still works
    const r2 = await executeTool("tool_a", {});
    expect(r2.is_error).toBe(true);
    const r3 = await executeTool("tool_b", {});
    expect(r3.content).toBe("result from tool_b");
  });

  it("unloads a single module and removes its loop and harness registrations", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      onLoad: (ctx) => {
        ctx.registerDynamicStateProvider("mod-a-state", () => "A");
        ctx.registerHarnessHook({
          kind: "preRun",
          name: "mod-a-hook",
          handler: () => {},
        });
      },
    });
    await loader.load({
      name: "mod-b",
      onLoad: (ctx) => {
        ctx.registerDynamicStateProvider("mod-b-state", () => "B");
        ctx.registerHarnessHook({
          kind: "preRun",
          name: "mod-b-hook",
          handler: () => {},
        });
      },
    });

    expect(collectDynamicState({ activeTools: new Set() })).toBe("AB");
    expect(listHarnessHooks("preRun").map((hook) => hook.name)).toEqual([
      "mod-a-hook",
      "mod-b-hook",
    ]);

    await loader.unload("mod-a");

    expect(collectDynamicState({ activeTools: new Set() })).toBe("B");
    expect(listHarnessHooks("preRun").map((hook) => hook.name)).toEqual([
      "mod-b-hook",
    ]);

    await loader.unloadAll();

    expect(collectDynamicState({ activeTools: new Set() })).toBe("");
    expect(listHarnessHooks("preRun")).toEqual([]);
  });

  it("removes grouped tools from TOOL_GROUPS on unload", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "grouped-unload-mod",
      tools: [{ ...makeTool("grouped_unload_tool"), group: "test_unload_group" }],
    });

    expect(TOOL_GROUPS.test_unload_group).toContain("grouped_unload_tool");

    await loader.unload("grouped-unload-mod");
    expect(TOOL_GROUPS.test_unload_group).toBeUndefined();
  });

  it("removes grouped tools from TOOL_GROUPS on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "grouped-unload-all-mod",
      tools: [{ ...makeTool("grouped_unload_all_tool"), group: "test_unload_all_group" }],
    });

    expect(TOOL_GROUPS.test_unload_all_group).toContain("grouped_unload_all_tool");

    await loader.unloadAll();
    expect(TOOL_GROUPS.test_unload_all_group).toBeUndefined();
  });

  it("unload returns false for unknown module", async () => {
    const loader = new ModuleLoader({});
    expect(await loader.unload("nonexistent")).toBe(false);
  });

  it("unload rejects when dependents exist", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "base" });
    await loader.load({ name: "child", dependencies: ["base"] });

    await expect(loader.unload("base")).rejects.toThrow(
      'Cannot unload "base": depended on by "child"',
    );
  });

  it("unload calls onUnload", async () => {
    const unloadCalled = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "evt-mod",
      onUnload: unloadCalled,
    });

    await loader.unload("evt-mod");
    expect(unloadCalled).toHaveBeenCalledOnce();
  });

  it("reloads a module — re-registers tools and calls onLoad again", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});

    await loader.load({
      name: "reload-mod",
      tools: [makeTool("reload_tool")],
      onLoad,
    });
    expect(onLoad).toHaveBeenCalledTimes(1);

    const r1 = await executeTool("reload_tool", {});
    expect(r1.content).toBe("result from reload_tool");

    const reloaded = await loader.reload("reload-mod");
    expect(reloaded).toBe(true);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(loader.getLoadedModules()).toEqual(["reload-mod"]);

    // Tool still works after reload
    const r2 = await executeTool("reload_tool", {});
    expect(r2.content).toBe("result from reload_tool");
  });

  it("reload returns false for unknown module", async () => {
    const loader = new ModuleLoader({});
    expect(await loader.reload("nonexistent")).toBe(false);
  });

  it("reload cleans up config keys, skills, workflows, and channels", async () => {
    clearRegisteredConfigSlices();
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cleanup-mod",
      tools: [makeTool("cleanup_tool")],
      configSlices: [fakeSlice("cleanupMod")],
    });

    expect(loader.getRegisteredConfigKeys().has("cleanupMod")).toBe(true);

    await loader.reload("cleanup-mod");

    expect(loader.getRegisteredConfigKeys().has("cleanupMod")).toBe(true);
    expect(loader.getLoadedModules()).toEqual(["cleanup-mod"]);
    const r = await executeTool("cleanup_tool", {});
    expect(r.content).toBe("result from cleanup_tool");
  });

  it("unload cleans up config keys", async () => {
    clearRegisteredConfigSlices();
    const loader = new ModuleLoader({});
    await loader.load({
      name: "cfgkey-mod",
      configSlices: [fakeSlice("cfgKeyMod")],
    });
    expect(loader.getRegisteredConfigKeys().has("cfgKeyMod")).toBe(true);

    await loader.unload("cfgkey-mod");
    expect(loader.getRegisteredConfigKeys().has("cfgKeyMod")).toBe(false);
  });

  it("getDependents returns correct dependents", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "core" });
    await loader.load({ name: "ext-a", dependencies: ["core"] });
    await loader.load({ name: "ext-b", dependencies: ["core"] });
    await loader.load({ name: "standalone" });

    expect(loader.getDependents("core").sort()).toEqual(["ext-a", "ext-b"]);
    expect(loader.getDependents("standalone")).toEqual([]);
    expect(loader.getDependents("ext-a")).toEqual([]);
  });
});

describe("source reimport", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    tmpDir = mkdtempSync(join(tmpdir(), "kota-reimport-"));
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("reimport picks up changed module source from disk", async () => {
    const modDir = join(tmpDir, ".kota", "modules", "test-mod");
    mkdirSync(modDir, { recursive: true });

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default { name: "test-mod", version: "1.0.0", description: "v1" };`,
    );

    const url1 = pathToFileURL(join(modDir, "index.mjs")).href;
    const mod1 = await import(url1);
    expect(mod1.default.description).toBe("v1");

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default { name: "test-mod", version: "2.0.0", description: "v2" };`,
    );

    const cachedMod = await import(url1);
    expect(cachedMod.default.description).toBe("v1");

    const cacheBustedUrl = `${url1}?v=${Date.now()}`;
    const mod2 = await import(cacheBustedUrl);
    expect(mod2.default.description).toBe("v2");
  });

  it("ModuleLoader.reload re-imports installed module from disk", async () => {
    const modDir = join(tmpDir, ".kota", "modules", "disk-mod");
    mkdirSync(modDir, { recursive: true });

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default {
        name: "disk-mod",
        description: "original",
        tools: [{
          tool: { name: "disk_tool", description: "disk tool", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "v1" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
        }],
      };`,
    );

    const loader = new ModuleLoader({});
    loader.setCwd(tmpDir);

    const { reimportInstalledModule } = await import("./module-discovery.js");
    const mod = await reimportInstalledModule("disk-mod", tmpDir);
    expect(mod).not.toBeNull();

    await loader.loadAll([], [mod!]);

    const r1 = await executeTool("disk_tool", {});
    expect(r1.content).toBe("v1");

    writeFileSync(
      join(modDir, "index.mjs"),
      `export default {
        name: "disk-mod",
        description: "updated",
        tools: [{
          tool: { name: "disk_tool", description: "disk tool", input_schema: { type: "object", properties: {} } },
          runner: async () => ({ content: "v2" }),
          effect: { kind: "read", scope: "local-fs", idempotent: true, openWorld: false },
        }],
      };`,
    );

    const reloaded = await loader.reload("disk-mod");
    expect(reloaded).toBe(true);

    const r2 = await executeTool("disk_tool", {});
    expect(r2.content).toBe("v2");

    await loader.unloadAll();
  });
});

describe("route discovery caches snapshots", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("calls each module's routes() factory exactly once during load", async () => {
    const loader = new ModuleLoader({});
    const handler = vi.fn();
    const routesFactory = vi.fn(() => [{ method: "GET" as const, path: "/a", handler }]);

    await loader.load({ name: "route-a", routes: routesFactory });

    loader.getRoutes();
    loader.getRoutes();
    loader.getModuleSummaries();
    loader.getModuleSummaries();

    expect(routesFactory).toHaveBeenCalledOnce();
  });

  it("calls each module's commands() factory exactly once during load", async () => {
    const loader = new ModuleLoader({});
    const { Command } = await import("commander");
    const commandsFactory = vi.fn(() => [new Command("test-cmd")]);

    await loader.load({ name: "cmd-mod", commands: commandsFactory });

    loader.getCommands();
    loader.getCommands();
    loader.getModuleSummaries();

    expect(commandsFactory).toHaveBeenCalledOnce();
  });

  it("ctx.getRoutes() inside a routes() factory sees previously loaded modules' cached routes", async () => {
    const loader = new ModuleLoader({});
    const handler = vi.fn();

    await loader.load({
      name: "route-a",
      routes: () => [{ method: "GET", path: "/a", handler }],
    });

    let innerRoutes: any[] = [];
    await loader.load({
      name: "route-b",
      routes: (ctx) => {
        innerRoutes = ctx.getRoutes();
        return [{ method: "GET", path: "/b", handler }];
      },
    });

    const routes = loader.getRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path).sort()).toEqual(["/a", "/b"]);
    expect(innerRoutes.map((r: { path: string }) => r.path)).toEqual(["/a"]);
  });

  it("returns stable results across repeated calls", async () => {
    const loader = new ModuleLoader({});
    const handler = vi.fn();

    await loader.load({
      name: "route-mod",
      routes: () => [{ method: "GET", path: "/test", handler }],
    });

    const routes1 = loader.getRoutes();
    const routes2 = loader.getRoutes();
    expect(routes1).toHaveLength(1);
    expect(routes2).toHaveLength(1);
  });

  it("caches the empty result when routes() throws and surfaces the error in summaries", async () => {
    const loader = new ModuleLoader({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn();

    await loader.load({
      name: "throws-mod",
      routes: () => { throw new Error("bad routes"); },
    });
    await loader.load({
      name: "good-mod",
      routes: () => [{ method: "GET", path: "/ok", handler }],
    });

    expect(loader.getRoutes()).toHaveLength(1);
    expect(loader.getRoutes()).toHaveLength(1);

    const throwsSummary = loader.getModuleSummaries().find((s) => s.name === "throws-mod");
    expect(throwsSummary?.routeError).toBe("bad routes");

    errSpy.mockRestore();
  });
});

describe("module discovery is side-effect free across repeated reads", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("invokes routes() exactly once during load even when getRoutes/getModuleSummaries are called many times", async () => {
    const loader = new ModuleLoader({});
    const routesFactory = vi.fn(() => []);

    await loader.load({ name: "discovery-only", routes: routesFactory });

    loader.getRoutes();
    loader.getRoutes();
    loader.getModuleSummaries();
    loader.getModuleSummaries();
    loader.getRoutes();

    expect(routesFactory).toHaveBeenCalledOnce();
  });

  it("invokes routes() exactly once during \"commands\" mode load too", async () => {
    const loader = new ModuleLoader({}, false, { mode: "commands" });
    const routesFactory = vi.fn(() => [
      { method: "GET" as const, path: "/x", handler: () => {} },
    ]);

    await loader.load({ name: "discovery-only", routes: routesFactory });

    // Factory ran once during load; getModuleSummaries reads the cached
    // snapshot without re-invoking it. getRoutes is runtime-only and
    // throws in commands mode (covered by the runtime-getter guard test).
    expect(routesFactory).toHaveBeenCalledOnce();
    loader.getModuleSummaries();
    loader.getModuleSummaries();
    expect(routesFactory).toHaveBeenCalledOnce();
  });
});

describe("Module SDK — storage, config, skills", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    tmpDir = mkdtempSync(join(tmpdir(), "kota-test-"));
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("provides scoped storage via ModuleContext", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false);
    await loader.load({ name: "storage-mod", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.storage).toBeDefined();
    expect(ctx.storage.getDir()).toContain(".kota/modules/storage-mod");
  });

  it("each module gets its own isolated storage", async () => {
    const onLoadA = vi.fn();
    const onLoadB = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "mod-a", onLoad: onLoadA });
    await loader.load({ name: "mod-b", onLoad: onLoadB });

    const storageA = onLoadA.mock.calls[0][0].storage;
    const storageB = onLoadB.mock.calls[0][0].storage;
    expect(storageA.getDir()).not.toBe(storageB.getDir());
    expect(storageA.getDir()).toContain("mod-a");
    expect(storageB.getDir()).toContain("mod-b");
  });

  it("getModuleConfig returns the module's config section", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({
      modules: {
        "my-mod": { apiKey: "secret", retries: 3 },
      },
    });
    await loader.load({ name: "my-mod", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    const config = ctx.getModuleConfig();
    expect(config).toEqual({ apiKey: "secret", retries: 3 });
  });

  it("getModuleConfig returns undefined when no config exists", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({});
    await loader.load({ name: "no-config", onLoad });

    const ctx = onLoad.mock.calls[0][0];
    expect(ctx.getModuleConfig()).toBeUndefined();
  });

  it("collects skill content from modules", async () => {
    const skillPath = join(tmpDir, "helper.md");
    writeFileSync(skillPath, "Use the helper tool for quick lookups.");
    const loader = new ModuleLoader({}, false);
    loader.setCwd(tmpDir);
    await loader.load({
      name: "helper-mod",
      skills: [{ name: "helper", promptPath: "helper.md" }],
    });

    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("## Module Capabilities");
    expect(prompt).toContain("### helper");
    expect(prompt).toContain("Use the helper tool for quick lookups.");
  });

  it("loads packaged module skill content outside the project directory", async () => {
    const loader = new ModuleLoader({}, false);
    loader.setCwd(tmpDir);
    await loader.load({
      name: "knowledge-guidance-mod",
      skills: [{ name: "knowledge-guidance", promptPath: "src/modules/knowledge/knowledge.md" }],
    });

    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("### knowledge-guidance");
    expect(prompt).toContain("Structured knowledge entries");
  });

  it("handles missing skill file gracefully", async () => {
    const chunks: string[] = [];
    installRenderingCapture(chunks);
    const loader = new ModuleLoader({});
    await loader.load({
      name: "broken-mod",
      skills: [{ name: "missing", promptPath: "nonexistent/skill.md" }],
    });

    expect(loader.getSkillsPrompt()).toBe("");
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Module "broken-mod" skill "missing" failed to load'),
      ]),
    );
  });

  it("rejects module skill frontmatter tool-policy declarations", async () => {
    const skillPath = join(tmpDir, "restricted.md");
    writeFileSync(
      skillPath,
      "---\nname: restricted\ndisallowed-tools: [Bash]\n---\nRestricted guidance.",
    );
    const loader = new ModuleLoader({}, false);
    loader.setCwd(tmpDir);

    await expect(loader.load({
      name: "restricted-mod",
      skills: [{ name: "restricted", promptPath: "restricted.md" }],
    })).rejects.toThrow(
      'restricted.md: unsupported skill tool-policy frontmatter "disallowed-tools"',
    );
  });

  it("collects multiple skills in load order", async () => {
    const skillA = join(tmpDir, "skill-a.md");
    const skillB = join(tmpDir, "skill-b.md");
    writeFileSync(skillA, "Section A content.");
    writeFileSync(skillB, "Section B content.");
    const loader = new ModuleLoader({});
    loader.setCwd(tmpDir);
    await loader.load({
      name: "mod-a",
      skills: [{ name: "skill-a", promptPath: "skill-a.md" }],
    });
    await loader.load({
      name: "mod-b",
      skills: [{ name: "skill-b", promptPath: "skill-b.md" }],
    });

    const prompt = loader.getSkillsPrompt();
    const idxA = prompt.indexOf("### skill-a");
    const idxB = prompt.indexOf("### skill-b");
    expect(idxA).toBeLessThan(idxB);
    expect(prompt).toContain("Section A content.");
    expect(prompt).toContain("Section B content.");
  });

  it("getModuleStorage returns storage for loaded module", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "stored-mod" });

    const storage = loader.getModuleStorage("stored-mod");
    expect(storage).toBeDefined();
    expect(storage!.getDir()).toContain("stored-mod");
  });

  it("getModuleStorage returns undefined for unknown module", () => {
    const loader = new ModuleLoader({});
    expect(loader.getModuleStorage("unknown")).toBeUndefined();
  });

  it("cleans up storage references on unloadAll", async () => {
    const loader = new ModuleLoader({});
    await loader.load({ name: "cleanup-storage" });
    expect(loader.getModuleStorage("cleanup-storage")).toBeDefined();

    await loader.unloadAll();
    expect(loader.getModuleStorage("cleanup-storage")).toBeUndefined();
  });

  it("\"commands\" mode loads skill prompt content so getSkillsPrompt returns the same text as runtime mode", async () => {
    const skillPath = join(tmpDir, "skill.md");
    writeFileSync(skillPath, "Should appear in commands mode too.");
    const loader = new ModuleLoader({}, false, { mode: "commands" });
    loader.setCwd(tmpDir);
    await loader.load({
      name: "skill-mod",
      skills: [{ name: "skill", promptPath: "skill.md" }],
    });

    // Skill prompt content is statically loaded during load() regardless of
    // mode — it does not depend on onLoad side effects, so commands mode
    // exposes the same text a runtime loader would.
    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("### skill");
    expect(prompt).toContain("Should appear in commands mode too.");
  });
});

describe("ctx.callTool — direct tool invocation", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("invokes a registered tool and returns its result", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "tool-provider",
      tools: [makeTool("helper_tool")],
    });

    let capturedCtx: any;
    await loader.load({
      name: "tool-caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("helper_tool", {});
    expect(result.content).toBe("result from helper_tool");
    expect(result.is_error).toBeFalsy();
  });

  it("returns error for unknown tool", async () => {
    const loader = new ModuleLoader({});
    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("nonexistent_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  it("returns error when tool runner throws", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "throwing-mod",
      tools: [{
        tool: {
          name: "throws_tool",
          description: "Throws",
          input_schema: { type: "object" as const, properties: {} },
        },
        runner: async () => { throw new Error("boom"); },
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("throws_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("boom");
  });

  it("enforces recursion depth limit", async () => {
    const loader = new ModuleLoader({});
    let capturedCtx: any;

    await loader.load({
      name: "recursive-mod",
      tools: (ctx) => {
        capturedCtx = ctx;
        return [{
          tool: {
            name: "recursive_tool",
            description: "Calls itself",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => ctx.callTool("recursive_tool", {}),
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        }];
      },
    });

    const result = await capturedCtx.callTool("recursive_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("depth limit exceeded");
  });

  it("resets depth counter after successful call", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "tool-mod",
      tools: [makeTool("simple_tool")],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    // Multiple sequential calls should all succeed (depth resets)
    const r1 = await capturedCtx.callTool("simple_tool", {});
    const r2 = await capturedCtx.callTool("simple_tool", {});
    const r3 = await capturedCtx.callTool("simple_tool", {});
    expect(r1.content).toBe("result from simple_tool");
    expect(r2.content).toBe("result from simple_tool");
    expect(r3.content).toBe("result from simple_tool");
  });

  it("passes input to the tool runner", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "echo-mod",
      tools: [{
        tool: {
          name: "echo_tool",
          description: "Echoes input",
          input_schema: { type: "object" as const, properties: { msg: { type: "string" } } },
        },
        runner: async (input: Record<string, unknown>) => ({ content: `echo: ${input.msg}` }),
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (ctx) => { capturedCtx = ctx; },
    });

    const result = await capturedCtx.callTool("echo_tool", { msg: "hello" });
    expect(result.content).toBe("echo: hello");
  });

  it("allows chained tool calls within depth limit", async () => {
    const loader = new ModuleLoader({});

    // Tool A calls Tool B, which returns a result
    await loader.load({
      name: "chain-mod",
      tools: (ctx) => [
        {
          tool: {
            name: "tool_b",
            description: "Leaf tool",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => ({ content: "leaf result" }),
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        },
        {
          tool: {
            name: "tool_a",
            description: "Calls tool_b",
            input_schema: { type: "object" as const, properties: {} },
          },
          runner: async () => {
            const inner = await ctx.callTool("tool_b", {});
            return { content: `chained: ${inner.content}` };
          },
          effect: legacyEffect({ risk: "safe", kind: "discovery" }),
        },
      ],
    });

    let capturedCtx: any;
    await loader.load({
      name: "caller",
      onLoad: (c) => { capturedCtx = c; },
    });

    const result = await capturedCtx.callTool("tool_a", {});
    expect(result.content).toBe("chained: leaf result");
  });

  it("callTool works from event handlers via captured context", async () => {
    const bus = new EventBus();
    const loader = new ModuleLoader({});
    let eventResult: any;

    await loader.load({
      name: "tool-mod",
      tools: [makeTool("event_target")],
    });

    await loader.load({
      name: "event-caller",
      tools: (ctx) => {
        // Event handler captures ctx and uses callTool
        bus.on("test.trigger", async () => {
          eventResult = await ctx.callTool("event_target", {});
        });
        return [];
      },
    });

    bus.emit("test.trigger", {});
    // Wait for async handler
    await new Promise((r) => setTimeout(r, 10));
    expect(eventResult?.content).toBe("result from event_target");
  });

  it("probeHealthChecks collects results from modules with healthCheck", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "healthy-mod",
      healthCheck: () => ({ status: "healthy" }),
    });
    await loader.load({
      name: "degraded-mod",
      healthCheck: async () => ({ status: "degraded", message: "token expiring" }),
    });
    await loader.load({ name: "no-check-mod" });

    const results = await loader.probeHealthChecks();
    expect(results["healthy-mod"]).toEqual({ status: "healthy" });
    expect(results["degraded-mod"]).toEqual({ status: "degraded", message: "token expiring" });
    expect(results["no-check-mod"]).toBeUndefined();
  });

  it("probeHealthChecks catches thrown errors as unhealthy", async () => {
    const loader = new ModuleLoader({});
    await loader.load({
      name: "broken-mod",
      healthCheck: () => { throw new Error("boom"); },
    });

    const results = await loader.probeHealthChecks();
    expect(results["broken-mod"].status).toBe("unhealthy");
    expect(results["broken-mod"].message).toContain("boom");
  });

  it("collects configSlices from loaded modules", async () => {
    clearRegisteredConfigSlices();
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      configSlices: [fakeSlice("myKey", "test key")],
    });
    await loader.load({
      name: "mod-b",
      configSlices: [fakeSlice("otherKey")],
    });
    const keys = loader.getRegisteredConfigKeys();
    expect(keys.has("myKey")).toBe(true);
    expect(keys.has("otherKey")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("rejects duplicate configSlices across modules", async () => {
    clearRegisteredConfigSlices();
    const loader = new ModuleLoader({});
    await loader.load({
      name: "mod-a",
      configSlices: [fakeSlice("shared")],
    });
    await expect(
      loader.load({
        name: "mod-b",
        configSlices: [fakeSlice("shared")],
      }),
    ).rejects.toThrow(/already claimed by "mod-a"/);
  });

  it("returns empty set when no modules declare configSlices", async () => {
    clearRegisteredConfigSlices();
    const loader = new ModuleLoader({});
    await loader.load({ name: "plain" });
    expect(loader.getRegisteredConfigKeys().size).toBe(0);
  });
});
