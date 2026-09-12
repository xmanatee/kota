import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { listHarnessHooks } from "#core/agent-harness/hooks.js";
import { hasAgentHarness } from "#core/agent-harness/registry.js";
import {
  getRegisteredConfigSlice,
  type ModuleConfigSlice,
  registerConfigSlice,
} from "#core/config/config-slice.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  defineDaemonWideModuleEvent,
  getModuleEventRegistry,
} from "#core/events/module-event.js";
import { runCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { collectDynamicState } from "#core/loop/dynamic-state.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  networkWriteEffect,
  operatorSurfaceEffect,
  readOnlyLocalEffect,
} from "#core/tools/effect.js";
import { executeTool } from "#core/tools/index.js";
import { TOOL_GROUPS } from "#core/tools/tool-groups.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { withToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { admitDiscoveredModuleDefinitions } from "./module-admission.js";
import { registerAdmittedModuleConfigSlices } from "./module-config-slices.js";
import {
  captureDiagnostics,
  createModuleLoader as createLoader,
} from "./module-context.test-helpers.js";
import { ModuleLoader as RuntimeModuleLoader } from "./module-loader.js";
import { scopeSetupStatusOntoManifest } from "./module-manifest.js";
import type { KotaModule, ModuleRuntimeContext } from "./module-types.js";
import { defineProviderToken } from "./provider-token.js";

const unexpectedTransportCall = () => { throw new Error("Client admission must not use the transport"); };
const transport: DaemonTransport = {
  baseUrl: "http://unused.invalid",
  authHeaders: unexpectedTransportCall,
  request: unexpectedTransportCall,
  requestStrict: unexpectedTransportCall,
  fetchRaw: unexpectedTransportCall,
  events: unexpectedTransportCall,
};

function fakeSlice(key: string, description = "test"): ModuleConfigSlice {
  return {
    key: key as never,
    description,
    sanitize: (raw) =>
      (typeof raw === "object" && raw !== null ? raw : undefined) as never,
    merge: (base, override) =>
      ({ ...(base as object), ...(override as object) }) as never,
    scopeConfigSafety: "authority",
    schemaSource: { relativePath: "test", typeName: "TestConfig" },
  };
}

function makeTool(name: string) {
  return {
    tool: {
      name,
      description: `Test tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    runner: async () => ({ content: `result from ${name}` }),
    effect: readOnlyLocalEffect(),
  };
}

function makeAgent(name: string) {
  return {
    name,
    role: "fixture",
    promptPath: "src/core/modules/AGENTS.md",
    model: "fixture-model",
    effort: "low" as const,
    writeScope: "deny-all" as const,
  };
}

function makeRuntimeEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: "fixture.event",
    fields: ["id"],
    scope: "daemon",
    schema: {
      currentVersion: 1,
      payload: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
    filterablePaths: ["id"],
    sensitivity: "internal",
    compatibility: "backward",
    workflowTriggerPolicy: "allowed",
    examples: [],
    ...overrides,
  };
}

function makeAgentHarness(overrides: Record<string, unknown> = {}) {
  return {
    name: "fixture-harness",
    description: "Fixture harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota" as const,
    run: async () => {
      throw new Error("not invoked");
    },
    ...overrides,
  };
}

const malformedHarnessCases: [string, Record<string, unknown>, RegExp][] = [
  ["unknown model routing", { modelRouting: { kind: "guess" } }, /modelRouting has unsupported kind/],
  ["native routing without a provider", { modelRouting: { kind: "native" } }, /modelRouting.provider/],
  ["model-client routing with ignored provider", { modelRouting: { kind: "model-client", provider: "ignored" } }, /modelRouting has unknown fields/],
  ["an unknown field", { login: () => undefined }, /unknown field "login"/],
  [
    "a malformed native abort quarantine",
    { nativeAbortQuarantine: "eventual-stop" },
    /nativeAbortQuarantine must be "confirmed-stop"/,
  ],
  [
    "a non-callable readiness probe",
    { readiness: "not-callable" },
    /readiness must be a function/,
  ],
  [
    "a non-callable isolated auth resolver",
    { resolveIsolatedHostAuthEnv: {} },
    /resolveIsolatedHostAuthEnv must be a function/,
  ],
  [
    "a non-array unsupported option declaration",
    { unsupportedRunOptions: {} },
    /unsupportedRunOptions must be an array/,
  ],
  [
    "a non-object unsupported option",
    { unsupportedRunOptions: [null] },
    /unsupportedRunOptions\[0\] must be an object/,
  ],
  [
    "an unknown unsupported run option",
    {
      unsupportedRunOptions: [{
        option: "future",
        reason: "unsupported",
        runOption: "future",
      }],
    },
    /unsupportedRunOptions\[0\]\.runOption is invalid/,
  ],
  [
    "an unknown unsupported option field",
    {
      unsupportedRunOptions: [{
        option: "mcpServers",
        reason: "unsupported",
        runOptions: "mcpServers",
      }],
    },
    /unsupportedRunOptions\[0\] has unknown field "runOptions"/,
  ],
  [
    "a malformed unsupported option label",
    { unsupportedRunOptions: [{ option: " ", reason: "unsupported" }] },
    /unsupportedRunOptions\[0\]\.option must be a non-empty trimmed string/,
  ],
  [
    "a malformed unsupported option reason",
    { unsupportedRunOptions: [{ option: "custom", reason: 42 }] },
    /unsupportedRunOptions\[0\]\.reason must be a non-empty trimmed string/,
  ],
  [
    "a non-callable step options validator",
    { validateStepOptions: true },
    /validateStepOptions must be a function/,
  ],
  [
    "a non-callable model validator",
    { validateModelId: [] },
    /validateModelId must be a function/,
  ],
];

describe("ModuleLoader", () => {


  it("rejects a tool missing effect metadata", async () => {
    const loader = createLoader({});
    const { effect: _effect, ...tool } = makeTool("no_effect_tool");
    const mod = { name: "no-effect-mod", tools: [tool] } as never;

    await expect(loader.load(mod)).rejects.toThrow(
      "missing required metadata: effect",
    );
  });

  it.each([
    ["a non-object", null],
    ["a missing name", { description: "missing identity" }],
    ["a blank name", { name: " " }],
    ["an unknown compatibility field", { name: "legacy", enabled: true }],
    ["an obsolete operation declaration", {
      name: "legacy-operation",
      operations: [],
    }],
    ["a non-factory route contribution", { name: "bad-routes", routes: [] }],
    ["a channel without identity or a factory", {
      name: "bad-channel",
      channels: [{}],
    }],
    ["an agent without its required contract", {
      name: "bad-agent",
      agents: [{}],
    }],
    ["an event without its required policy", {
      name: "bad-event",
      events: [{
        name: "bad.event",
        fields: [],
        scope: "daemon",
        schema: {
          currentVersion: 1,
          payload: { type: "object", properties: {} },
        },
        filterablePaths: [],
        examples: [],
      }],
    }],
    ["duplicate dependencies", {
      name: "duplicate-deps",
      dependencies: ["base", "base"],
    }],
    ["a self dependency", { name: "self-dep", dependencies: ["self-dep"] }],
  ])("rejects %s before lifecycle admission", async (_label, declaration) => {
    const loader = createLoader({});

    await expect(loader.load(declaration as never)).rejects.toThrow(
      /Invalid module declaration/,
    );
    expect(loader.getLoadedModules()).toEqual([]);
  });

  it.each(malformedHarnessCases)(
    "rejects an agent harness with %s before lifecycle admission",
    async (_label, overrides, message) => {
      const loader = createLoader({});

      await expect(loader.load({
        name: "bad-agent-harness",
        agentHarnesses: [makeAgentHarness(overrides)],
      } as never)).rejects.toThrow(message);
      expect(loader.getLoadedModules()).toEqual([]);
      expect(hasAgentHarness("fixture-harness")).toBe(false);
    },
  );

  it.each([
    [
      "an unknown agent field",
      { schedule: "daily" },
      /agent\[0\] has unknown field "schedule"/,
    ],
    [
      "an unknown tool-policy field",
      { tools: { allowd: ["shell"] } },
      /agent\[0\]\.tools has unknown field "allowd"/,
    ],
  ])("rejects an agent with %s", async (_label, overrides, message) => {
    const loader = createLoader({});

    await expect(loader.load({
      name: "bad-agent-contract",
      agents: [{
        ...makeAgent("fixture-agent"),
        ...overrides,
      }],
    } as never)).rejects.toThrow(message);
    expect(loader.getLoadedModules()).toEqual([]);
  });

  it("rejects duplicate agent identities atomically across and within modules", async () => {
    const loader = createLoader({});
    const original = makeAgent("shared-agent");
    await loader.load({ name: "agent-owner", agents: [original] });

    await expect(loader.load({
      name: "agent-collider",
      agents: [makeAgent("shared-agent")],
    })).rejects.toThrow(
      'Module "agent-collider" tried to register agent "shared-agent" already owned by "agent-owner"',
    );
    expect(loader.getAgentDef("shared-agent")).toBe(original);
    expect(loader.getLoadedModules()).toEqual(["agent-owner"]);

    await expect(loader.load({
      name: "duplicate-agent-owner",
      agents: [makeAgent("duplicate-agent"), makeAgent("duplicate-agent")],
    })).rejects.toThrow(
      'Module "duplicate-agent-owner" declares duplicate agent "duplicate-agent"',
    );
    expect(loader.getAgentDef("duplicate-agent")).toBeUndefined();

    await loader.unload("agent-owner");
    expect(loader.getAgentDef("shared-agent")).toBeUndefined();
  });

  it.each([
    [
      "channel",
      {
        channels: [{
          name: "fixture-channel",
          create: () => null,
          enabled: false,
        }],
      },
      /channel\[0\] has unknown field "enabled"/,
    ],
    [
      "route",
      {
        routes: () => [{
          method: "GET",
          path: "/fixture",
          handler: () => undefined,
          enabled: false,
        }],
      },
      /routes\[0\] has unknown field "enabled"/,
    ],
    [
      "control route",
      {
        controlRoutes: () => [{
          method: "GET",
          path: "/fixture",
          capabilityScope: "read",
          handler: () => undefined,
          enabled: false,
        }],
      },
      /controlRoutes\[0\] has unknown field "enabled"/,
    ],
  ])(
    "rejects unknown fields on a nested %s declaration",
    async (_label, contribution, message) => {
      const loader = createLoader({});

      await expect(loader.load({
        name: "bad-nested-declaration",
        ...contribution,
      } as never)).rejects.toThrow(message);
      expect(loader.getLoadedModules()).toEqual([]);
    },
  );

  it.each([
    ["skill", {
      skills: [{ name: "fixture", promptPath: "fixture.md", enabled: false }],
    }],
    ["event", { events: [makeRuntimeEvent({ enabled: false })] }],
    ["config slice", {
      configSlices: [{ ...fakeSlice("fixture"), enabled: false }],
    }],
    ["tool", { tools: [{ ...makeTool("fixture_tool"), enabled: false }] }],
    ["UI surface", {
      uiSurfaces: [{ sourceId: "fixture", scope: () => [], enabled: false }],
    }],
    ["effect", {
      effects: [{
        id: "fixture.read",
        description: "Fixture read",
        source: "lifecycle",
        effect: readOnlyLocalEffect(),
        enabled: false,
      }],
    }],
  ])(
    "rejects obsolete metadata on a %s capability envelope",
    async (_label, contribution) => {
      const loader = createLoader({});

      await expect(loader.load({
        name: "obsolete-capability-metadata",
        ...contribution,
      } as never)).rejects.toThrow(/unknown field "enabled"/);
      expect(loader.getLoadedModules()).toEqual([]);
    },
  );

  it.each([
    ["an empty config schema", {}, /configSchema\.type must be "object"/],
    [
      "a non-JSON config schema extension",
      { type: "object", properties: {}, extension: () => undefined },
      /configSchema\.extension must be JSON-compatible/,
    ],
  ])("rejects %s", async (_label, configSchema, message) => {
    const loader = createLoader({});

    await expect(loader.load({
      name: "bad-config-schema",
      configSchema,
    } as never)).rejects.toThrow(message);
    expect(loader.getLoadedModules()).toEqual([]);
  });

  it("admits open JSON Schema keywords on config and tool schemas", async () => {
    const openSchema = {
      type: "object" as const,
      properties: {
        token: {
          type: "string",
          readOnly: true,
          $comment: "owned by the installed module's schema vocabulary",
        },
      },
      definitions: {
        token: { type: "string" },
      },
    };
    const openTool = makeTool("open_schema_tool");
    const loader = createLoader({});

    await loader.load({
      name: "open-json-schema",
      configSchema: openSchema,
      tools: [{
        ...openTool,
        tool: {
          ...openTool.tool,
          input_schema: openSchema,
          output_schema: openSchema,
        },
      }],
    });

    expect(loader.getLoadedModules()).toEqual(["open-json-schema"]);
  });

  it.each([
    [
      "an input schema without an object type",
      { properties: {} },
      undefined,
      /input_schema\.type must be "object"/,
    ],
    [
      "an input schema without properties",
      { type: "object" },
      undefined,
      /input_schema\.properties must be an object/,
    ],
    [
      "a non-object output schema",
      { type: "object", properties: {} },
      [],
      /output_schema must be an object/,
    ],
    [
      "an output schema without properties",
      { type: "object", properties: {} },
      { type: "object" },
      /output_schema\.properties must be an object/,
    ],
    [
      "a non-JSON input schema extension",
      { type: "object", properties: { value: { transform: () => undefined } } },
      undefined,
      /input_schema\.properties\.value\.transform must be JSON-compatible/,
    ],
  ])(
    "rejects a tool with %s",
    async (_label, inputSchema, outputSchema, message) => {
      const loader = createLoader({});

      await expect(loader.load({
        name: "bad-tool-contract",
        tools: [{
          tool: {
            name: "fixture_tool",
            description: "fixture",
            input_schema: inputSchema,
            ...(outputSchema === undefined
              ? {}
              : { output_schema: outputSchema }),
          },
          runner: async () => ({ content: "unused" }),
          effect: readOnlyLocalEffect(),
        }],
      } as never)).rejects.toThrow(message);
      expect(loader.getLoadedModules()).toEqual([]);
    },
  );

  it.each([
    [
      "duplicate fields",
      makeRuntimeEvent({ fields: ["id", "id"] }),
      /duplicate field "id"/,
    ],
    [
      "a field absent from its schema",
      makeRuntimeEvent({ fields: ["missing"] }),
      /field "missing" is not present/,
    ],
    [
      "duplicate filterable paths",
      makeRuntimeEvent({ filterablePaths: ["id", "id"] }),
      /duplicate filterable path "id"/,
    ],
    [
      "a malformed nested schema node",
      makeRuntimeEvent({
        schema: {
          currentVersion: 1,
          payload: {
            type: "object",
            properties: { id: { type: "array", items: { type: "unknown" } } },
          },
        },
      }),
      /properties\.id\.items\.type is invalid/,
    ],
  ])("rejects an event with %s", async (_label, event, message) => {
    const loader = createLoader({});

    await expect(
      loader.load({ name: "bad-event-contract", events: [event] } as never),
    )
      .rejects.toThrow(message);
    expect(loader.getLoadedModules()).toEqual([]);
  });

  it("leaves workflow capability decoding to the canonical workflow validator", async () => {
    const loader = createLoader({});
    await loader.load({
      name: "workflow-trigger-capabilities",
      workflows: [
        {
          name: "watch-capability",
          repository: "read",
          triggers: [{ watch: "src/**/*.ts" }],
          steps: [{ id: "noop", type: "code", run: () => undefined }],
        },
        {
          name: "webhook-capability",
          repository: "none",
          triggers: [{ webhook: true }],
          steps: [{ id: "noop", type: "code", run: () => undefined }],
        },
      ],
    });

    expect(validateWorkflowDefinitions(loader.getContributedWorkflows()))
      .toHaveLength(2);
  });

  it.each([
    ["commands", { commands: () => ({}) }],
    ["command entries", { commands: () => [{}] }],
    ["routes", { routes: () => ({}) }],
    ["route entries", { routes: () => [{ method: "GET", path: "/bad" }] }],
    ["control routes", {
      controlRoutes: () => [{
        method: "POST",
        path: "/bad",
        handler: () => undefined,
      }],
    }],
    ["activation", { onLoad: () => ({}) }],
  ])(
    "rejects malformed %s factory results before host admission",
    async (name, contribution) => {
      const loader = createLoader({});

      await expect(
        loader.load(
          {
            name: `bad-${name.replaceAll(" ", "-")}`,
            ...contribution,
          } as never,
        ),
      )
        .rejects.toThrow(/Invalid module declaration/);
      expect(loader.getLoadedModules()).toEqual([]);
    },
  );

  describe.each(["localClient", "daemonClient"] as const)("%s boundary", (surface) => {
    it.each([
      ["non-object result", null, /result must be an object/],
      ["unknown namespace", { invented: {} }, /unknown namespace "invented"/],
      ["missing required method", { recall: {} }, /recall\.recall must be a function/],
      ["unknown method", { recall: { recall: () => undefined, retiredRecall: () => undefined } },
        /recall contains unknown method "retiredRecall"/],
    ])("rejects %s", async (_label, result, error) => {
      const loader = createLoader({});
      const loading = loader.load({ name: "invalid-client", [surface]: () => result } as never);
      if (surface === "localClient") {
        await expect(loading).rejects.toThrow(error);
        expect(loader.getLocalClientHandlers()).toEqual({});
        expect(loader.getLoadedModules()).toEqual([]);
      } else {
        await loading;
        expect(() => loader.assembleDaemonClientHandlers(transport)).toThrow(error);
      }
    });
  });

  it("registers and unregisters declarative agent harnesses with module lifecycle", async () => {
    const loader = createLoader({});
    await loader.load({
      name: "harness-owner",
      agentHarnesses: [makeAgentHarness({ name: "owned-harness" })],
    });

    expect(hasAgentHarness("owned-harness")).toBe(true);
    await loader.unload("harness-owner");
    expect(hasAgentHarness("owned-harness")).toBe(false);
  });

  it.each([
    [
      "a malformed capability",
      { name: "bad-installed", channels: [{}] },
      "bad-installed",
      "channel[0]",
    ],
    ["a null declaration", null, "<invalid-installed-1>", "expected an object"],
    [
      "an undefined declaration",
      undefined,
      "<invalid-installed-1>",
      "expected an object",
    ],
  ])(
    "isolates %s while loading bundled modules",
    async (_label, declaration, name, error) => {
      const loader = createLoader({});

      await loader.loadAll(
        [{ name: "valid-bundled" }],
        [declaration] as never,
      );

      expect(loader.getLoadedModules()).toEqual(["valid-bundled"]);
      expect(loader.getModuleSummaries()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name,
          source: "installed",
          loadError: expect.stringContaining(error),
        }),
      ]));
    },
  );

  it("keeps a bundled module loaded when a malformed installed declaration reuses its name", async () => {
    const loader = createLoader({});

    await loader.loadAll(
      [{ name: "shared-name" }],
      [{ name: "shared-name", channels: [{}] }] as never,
    );

    expect(loader.getLoadedModules()).toEqual(["shared-name"]);
    const summaries = loader.getModuleSummaries()
      .filter((summary) => summary.name === "shared-name");
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ source: "bundled" });
    expect(summaries[0].loadError).toBeUndefined();
    expect(summaries[1]).toMatchObject({
      source: "installed",
      loadError: expect.stringContaining("channel[0]"),
    });
  });

  it("projects a module capability manifest from cached contributions and tool effects", async () => {
    const loader = createLoader({});
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
          scope: "scope",
          owner: "manifest-mod",
          sensitivity: "secret",
          health: { capabilityIds: ["manifest-mod.api"] },
          setup: {
            mode: "url",
            url: "https://example.invalid/settings",
            label: "Open settings",
          },
          secretRefs: [{ name: "MANIFEST_MOD_TOKEN", scope: "scope" }],
        },
      ],
      routes: () => [{
        method: "GET",
        path: "/api/manifest",
        handler: () => undefined,
      }],
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
          repository: "read",
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
            retention: "scope-durable",
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
            storeSecret:
              "/setup/requirements/manifest-mod/api-credential/secret",
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
    const withSetupStatus = scopeSetupStatusOntoManifest(manifest, [
      {
        moduleName: "manifest-mod",
        requirementId: "api-credential",
        kind: "secret",
        title: "API credential",
        required: true,
        scope: "scope",
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
          label: "Open settings",
          status: "pending",
          createdAt: "2026-06-13T00:00:00.000Z",
          expiresAt: "2026-06-13T00:10:00.000Z",
        },
      },
    ]);
    expect(withSetupStatus.contributions.setupRequirements[0]?.availability)
      .toMatchObject({
        state: "pending",
        reason: "url_setup_pending",
        pendingAction: {
          actionId: "manifest-mod.api-credential.1",
          complete: "/setup/actions/manifest-mod.api-credential.1/complete",
        },
      });
  });

  it.each([
    ["unknown capability reference", {
      additionalEffects: [{ id: "send", description: "Send", source: "tool",
        effect: networkWriteEffect(), capabilityIds: ["missing"] }],
    }, /references unknown capability id "missing"/],
    ["unknown capability scope", {
      capabilities: [{ id: "api", description: "API", scope: "workspace", scopePolicyHooks: [] }],
    }, /scope has unknown value "workspace"/],
    ["unknown data sensitivity", {
      dataClasses: [{ id: "payload", description: "Payload", sensitivity: "raw-token",
        retention: "run-artifact", redaction: "metadata-only" }],
    }, /sensitivity has unknown value "raw-token"/],
    ["unknown effect scope", {
      additionalEffects: [{ id: "send", description: "Send", source: "notification",
        effect: { kind: "write", scope: "operator", idempotent: false, openWorld: false } }],
    }, /tool effect scope has unknown value "operator"/],
    ["unknown simulation policy", {
      simulation: { support: "sometimes", blockedReasons: [] },
    }, /simulation support has unknown value "sometimes"/],
  ])("rejects %s before publishing contributions", async (_label, invalid, error) => {
    const loader = createLoader({});
    await expect(loader.load({
      name: "invalid-manifest", tools: [makeTool("rejected_tool")],
      manifest: {
        schemaVersion: 1,
        capabilities: [{ id: "api", description: "API", scope: "external", scopePolicyHooks: [] }],
        dataClasses: [],
        simulation: { support: "external-effects-blocked", blockedReasons: ["External writes blocked"] },
        ...invalid,
      },
    } as never)).rejects.toThrow(error);
    expect(loader.getLoadedModules()).toEqual([]);
    expect((await executeTool("rejected_tool", {})).is_error).toBe(true);
  });

  it("rejects external or operator-visible effects without explicit manifest coverage", async () => {
    await expect(
      createLoader({}).load({
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
      createLoader({}).load({
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
    const loader = createLoader({});

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
              repository: "read",
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

  it("preserves earlier workflow and channel owners when a later module rolls back", async () => {
    const loader = createLoader({});
    const ownerWorkflow = {
      repository: "read" as const,
      name: "shared/workflow",
      triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
      steps: [{ id: "noop", type: "code" as const, run: () => undefined }],
    };
    const ownerChannel = {
      name: "shared-channel",
      create: () => ({ status: "disabled" as const, reason: "fixture" }),
    };
    await loader.load({
      name: "valid-owner",
      workflows: [ownerWorkflow],
      channels: [ownerChannel],
    });

    await expect(loader.load({
      name: "rejected-owner",
      workflows: [{ ...ownerWorkflow }],
      channels: [{ ...ownerChannel }],
      effects: [{
        id: "rejected-owner.notify",
        description: "Notify an operator",
        source: "notification",
        effect: operatorSurfaceEffect(),
      }],
    })).rejects.toThrow(/must declare a manifest/);

    expect(loader.getContributedWorkflows()).toEqual([
      expect.objectContaining({
        name: ownerWorkflow.name,
        contributingModule: "valid-owner",
      }),
    ]);
    expect(loader.getContributedChannels()).toEqual([ownerChannel]);
  });

  it("does not leak an earlier local-client namespace when a later namespace collides", async () => {
    const loader = createLoader({});
    const modulesHandler = { list: async () => [] };
    await loader.load({
      name: "modules-client-owner",
      localClient: () => ({ modules: modulesHandler }) as never,
    });

    await expect(loader.load({
      name: "rejected-client-owner",
      localClient: () =>
        ({
          recall: { recall: async () => ({}) },
          modules: { list: async () => [] },
        }) as never,
    })).rejects.toThrow(/local client handler for "modules"/);

    expect(loader.getLocalClientHandlers()).toEqual({
      modules: modulesHandler,
    });
  });

  it("rejects explicit manifests that omit simulation blocking for projected effects", async () => {
    await expect(
      createLoader({}).load({
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
    ).rejects.toThrow(
      /simulation support "full" conflicts with blocked effects: tool\.send_without_blocking/,
    );
  });

  it("rejects duplicate module names", async () => {
    const loader = createLoader({});
    await loader.load({ name: "dup" });
    await expect(loader.load({ name: "dup" })).rejects.toThrow(
      'Duplicate module name: "dup"',
    );
  });

  it("rejects modules with missing dependencies", async () => {
    const loader = createLoader({});
    const mod: KotaModule = {
      name: "dependent",
      dependencies: ["missing-dep"],
    };
    await expect(loader.load(mod)).rejects.toThrow(
      'Module "dependent" requires "missing-dep" which is not loaded',
    );
  });

  it("orders dependency activation and preserves dependents until they can be unloaded", async () => {
    const loader = createLoader({});
    const activated: string[] = [];
    const module = (name: string, dependencies: string[] = []): KotaModule => ({
      name, dependencies, onLoad: () => { activated.push(name); },
    });
    await loader.loadAll([module("child", ["base"]), module("base"), module("independent")]);
    expect(activated.filter((name) => name !== "independent")).toEqual(["base", "child"]);
    expect(loader.getDependents("base")).toEqual(["child"]);
    expect(loader.getDependents("independent")).toEqual([]);
    await expect(loader.unload("base")).rejects.toThrow('depended on by "child"');
    expect(loader.getLoadedModules()).toContain("base");
    await loader.unload("child");
    expect(await loader.unload("base")).toBe(true);
    await loader.unloadAll();
  });

  it("exposes scoped configuration and earlier contributions to dependent activation", async () => {
    const loader = createLoader({ model: "test-model" }, true);
    const route = { method: "POST" as const, path: "/api/test", handler: () => {} };
    const workflow = {
      repository: "read" as const, name: "producer/job", triggers: [{ intervalMs: 1000 }],
      steps: [{ id: "noop", type: "code" as const, run: () => {} }],
    };
    const channel = { name: "producer.channel", create: () => ({ status: "disabled" as const, reason: "fixture" }) };
    await loader.load({ name: "producer", routes: () => [route], workflows: [workflow], channels: [channel] });
    await loader.load({ name: "consumer", dependencies: ["producer"], onLoad: (ctx) => {
      expect(ctx.cwd).toBe(process.cwd());
      expect(ctx.verbose).toBe(true);
      expect(ctx.config.model).toBe("test-model");
      expect(ctx.getRoutes()).toEqual([route]);
      expect(ctx.getContributedWorkflows()).toEqual([expect.objectContaining(workflow)]);
      expect(ctx.getContributedChannels()).toEqual([channel]);
    } });
    expect(loader.getContributedWorkflows()).toMatchObject([{
      ...workflow, moduleRoot: process.cwd(), contributingModule: "producer", moduleSource: "bundled",
    }]);
    expect(loader.getContributedChannels()).toEqual([channel]);
    await loader.unloadAll();
  });

  it("withdraws tools before reverse disposal and continues cleanup after a disposer fails", async () => {
    const loader = createLoader({});
    const disposed: string[] = [];
    const chunks: string[] = [];
    captureDiagnostics(chunks);
    await loader.loadAll(["base", "dependent"].map((name): KotaModule => ({
      name, ...(name === "dependent" ? { dependencies: ["base"] } : {}),
      tools: [makeTool(name)],
      onLoad: () => ({ dispose: async () => {
        expect((await executeTool("base", {})).is_error).toBe(true);
        expect((await executeTool("dependent", {})).is_error).toBe(true);
        disposed.push(name);
        if (name === "dependent") throw new Error("cleanup failed");
      } }),
    })));
    expect((await executeTool("base", {})).content).toBe("result from base");
    await loader.unloadAll();
    expect(disposed).toEqual(["dependent", "base"]);
    expect(loader.getLoadedModules()).toEqual([]);
    expect(chunks.join("\n")).toContain('Module "dependent" unload error: cleanup failed');
    await loader.unloadAll();
    expect(disposed).toEqual(["dependent", "base"]);
  });

  it.each([
    { source: "bundled", verbose: false, logged: true },
    { source: "installed", verbose: false, logged: false },
    { source: "installed", verbose: true, logged: true },
  ] as const)("isolates and reports $source activation failure with verbose=$verbose", async ({ source, verbose, logged }) => {
    const loader = createLoader({}, verbose);
    const chunks: string[] = [];
    captureDiagnostics(chunks);
    const broken: KotaModule = { name: "broken", onLoad: () => { throw new Error("activation failed"); } };
    const healthy: KotaModule = { name: "healthy" };
    const loading = source === "bundled"
      ? loader.loadAll([broken, healthy]) : loader.loadAll([healthy], [broken]);
    if (source === "bundled") await expect(loading).rejects.toThrow("1 bundled module(s) failed to load");
    else await loading;
    expect(loader.getLoadedModules()).toEqual(["healthy"]);
    expect(loader.getModuleSummaries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "healthy", source: "bundled" }),
      expect.objectContaining({ name: "broken", source, loadError: "activation failed", toolNames: [] }),
    ]));
    expect(chunks.some((chunk) => chunk.includes('"broken"'))).toBe(logged);
    await loader.unloadAll();
  });

  it('"commands" mode skips tool registration and onLoad', async () => {
    const onLoad = vi.fn();
    const loader = createLoader({}, false, { mode: "commands" });
    const { Command } = await import("commander");

    await loader.load({
      name: "cmd-only-mod",
      tools: [makeTool("should_not_register")],
      onLoad,
      commands: () => [new Command("my-cmd").description("test")],
      agents: [makeAgent("command-agent")],
      workflows: [{
        repository: "read",
        name: "command-job",
        triggers: [{ intervalMs: 1000 }],
        steps: [{ id: "noop", type: "code", run: () => {} }],
      }],
      channels: [{
        name: "command-channel",
        create: () => ({ status: "disabled", reason: "fixture" }),
      }],
      routes: () => [{ method: "GET", path: "/runtime", handler: () => {} }],
      controlRoutes: () => [{
        method: "GET",
        path: "/control",
        capabilityScope: "read",
        handler: () => {},
      }],
      healthCheck: () => ({ status: "healthy" }),
    });

    expect(loader.getLoadedModules()).toEqual(["cmd-only-mod"]);
    expect(loader.getMode()).toBe("commands");
    expect(loader.getToolCount()).toBe(0);
    const result = await executeTool("should_not_register", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
    expect(onLoad).not.toHaveBeenCalled();
    const cmds = loader.getCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name()).toBe("my-cmd");
    expect(loader.getAgentDef("command-agent")?.name).toBe("command-agent");
    expect(loader.getContributedWorkflows()).toMatchObject([{ name: "command-job" }]);
    expect(loader.getContributedChannels()).toMatchObject([{ name: "command-channel" }]);
    expect(loader.getModuleSummaries()).toMatchObject([{ name: "cmd-only-mod" }]);
    expect(() => loader.getRoutes()).toThrow(/lifecycle mode "runtime"/);
    expect(() => loader.getContributedControlRoutes()).toThrow(/lifecycle mode "runtime"/);
    await expect(loader.probeHealthChecks()).rejects.toThrow(/lifecycle mode "runtime"/);
  });

  it("serializes lifecycle mutations and recovers after rejected work", async () => {
    const loader = createLoader({});
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let disposedB = false;
    await loader.load({ name: "queued-a", onLoad: () => ({ dispose: async () => { entered(); await barrier; } }) });
    await loader.load({ name: "queued-b", onLoad: () => ({ dispose: () => { disposedB = true; } }) });
    const a = loader.unload("queued-a");
    await started;
    const b = loader.unload("queued-b");
    try {
      await Promise.resolve();
      expect(disposedB).toBe(false);
    } finally {
      release();
      await Promise.all([a, b]);
    }
    expect(loader.getModuleSummaries()).toEqual([]);
    await expect(loader.load({ name: "rejected", dependencies: ["missing"] })).rejects.toThrow();
    await loader.load({ name: "queued-b" });
    expect(loader.getLoadedModules()).toEqual(["queued-b"]);
    await loader.unloadAll();
  });

  it("closes every context registration before asynchronous disposal without leaving residue", async () => {
    const loader = createLoader({});
    const token = defineProviderToken<string>("disposal-provider");
    const cleanup = vi.fn();
    const listener = vi.fn();
    let context!: ModuleRuntimeContext;
    let unsubscribe!: () => void;
    let release!: () => void;
    let entered!: () => void;
    const disposing = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const contributions = (ctx: ModuleRuntimeContext) => [
      () => ctx.registerGroup("late-group", ["disposal_boundary_tool"]),
      () => ctx.registerMiddleware("late-middleware", async (_call, next) => next()),
      () => ctx.registerDynamicStateProvider("late-state", () => "late-state"),
      () => ctx.registerCleanupHook(cleanup),
      () => ctx.registerPreSendHook("late-pre-send", async () => null),
      () => ctx.registerHarnessHook({ kind: "preRun", name: "late-pre-run", handler: () => {} }),
      () => ctx.registerHarnessHook({ kind: "postRun", name: "late-post-run", handler: () => {} }),
      () => ctx.registerProvider(token, "late-provider"),
      () => ctx.events.subscribe("runtime.idle", listener),
      () => ctx.events.subscribeExternal("late.external", listener),
    ];
    await loader.load({
      name: "disposal-boundary",
      tools: [makeTool("disposal_boundary_tool")],
      onLoad: (ctx) => {
        context = ctx;
        ctx.registerMiddleware("disposal-boundary", async (_call, next) => {
          await barrier;
          const result = await next();
          return { content: `completed: ${result.content}` };
        });
        unsubscribe = ctx.events.subscribeExternal("cleanup.event", listener);
        return { dispose: async () => {
          entered();
          await barrier;
          // Disposal still has its ordinary cleanup and event-emission capabilities.
          unsubscribe();
          ctx.events.emitExternal("cleanup.event", {});
        } };
      },
    });
    const rejectLateContributions = () => {
      for (const register of contributions(context)) {
        expect(register).toThrow(/registration lifetime is closed/);
      }
    };
    const running = getToolMiddleware().execute(
      { name: "already-running", input: {} },
      async () => ({ content: "in-flight call" }),
    );
    const unloading = loader.unload("disposal-boundary");
    await disposing;
    try {
      expect((await executeTool("disposal_boundary_tool", {})).is_error).toBe(true);
      expect(getToolMiddleware().list()).not.toContain("disposal-boundary");
      rejectLateContributions();
    } finally {
      release();
      await unloading;
    }
    expect(await running).toEqual({ content: "completed: in-flight call" });
    rejectLateContributions();
    expect(context.events.listenerCount()).toBe(0);
    expect(context.getProvider(token)).toBeNull();
    expect(TOOL_GROUPS["late-group"]).toBeUndefined();
    expect(getToolMiddleware().list()).not.toContain("late-middleware");
    expect(collectDynamicState({ activeTools: new Set() })).toBe("");
    expect(listHarnessHooks("preRun")).toEqual([]);
    expect(listHarnessHooks("postRun")).toEqual([]);
    runCleanupHooks();
    expect(cleanup).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    // Reusing every identity also proves rejection did not publish a hook first
    // and only then fail to track its disposer.
    await loader.load({
      name: "disposal-boundary",
      onLoad: (ctx) => { for (const register of contributions(ctx)) register(); },
    });
    rejectLateContributions();
    expect(context.getProvider(token)).toBe("late-provider");
    expect(context.events.listenerCount()).toBe(2);
    await loader.unloadAll();
    rejectLateContributions();
    expect(getToolMiddleware().list()).not.toContain("late-middleware");
    expect(collectDynamicState({ activeTools: new Set() })).toBe("");
    runCleanupHooks();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("revokes a rejected load's context across replacement and another host's lifetime", async () => {
    const loader = createLoader({});
    const other = createLoader({});
    const token = defineProviderToken<string>("retained-provider");
    let stale!: ModuleRuntimeContext;
    let current!: ModuleRuntimeContext;
    let peer!: ModuleRuntimeContext;
    let unsubscribe!: () => void;
    const listener = vi.fn();
    await other.load({ name: "retained-owner", onLoad: (ctx) => {
      peer = ctx;
      ctx.registerMiddleware("peer-middleware", async (_call, next) => next());
      ctx.registerProvider(token, "peer");
      ctx.events.subscribeExternal("retained.event", listener);
    } });
    await expect(loader.load({ name: "retained-owner", onLoad: (ctx) => {
      stale = ctx;
      ctx.registerMiddleware("retained-middleware", async (_call, next) => next());
      ctx.registerProvider(token, "rejected");
      unsubscribe = ctx.events.subscribeExternal("retained.event", listener);
      throw new Error("activation failed");
    } })).rejects.toThrow("activation failed");
    const rejectDelayedCallback = async () => {
      await Promise.resolve();
      expect(() => stale.registerMiddleware("retained-middleware", async (_call, next) => next()))
        .toThrow(/registration lifetime is closed/);
      expect(() => stale.registerProvider(token, "stale"))
        .toThrow(/registration lifetime is closed/);
      expect(() => stale.events.subscribeExternal("retained.event", listener))
        .toThrow(/registration lifetime is closed/);
    };
    await rejectDelayedCallback();
    expect(getToolMiddleware().list()).not.toContain("retained-middleware");
    expect(stale.getProvider(token)).toBeNull();
    expect(stale.events.listenerCount()).toBe(0);
    await loader.load({ name: "retained-owner", onLoad: (ctx) => {
      current = ctx;
      ctx.registerMiddleware("retained-middleware", async (_call, next) => next());
      ctx.registerProvider(token, "replacement");
      ctx.events.subscribeExternal("retained.event", listener);
    } });
    await rejectDelayedCallback();
    unsubscribe();
    expect(current.getProvider(token)).toBe("replacement");
    expect(current.events.listenerCount()).toBe(1);
    await loader.unloadAll();
    await rejectDelayedCallback();
    expect(getToolMiddleware().list()).not.toContain("retained-middleware");
    expect(getToolMiddleware().list()).toContain("peer-middleware");
    expect(peer.getProvider(token)).toBe("peer");
    peer.events.emitExternal("retained.event", {});
    expect(listener).toHaveBeenCalledTimes(1);
    await other.unloadAll();
    expect(getToolMiddleware().list()).not.toContain("peer-middleware");
  });

  it("commands-loader teardown preserves registrations owned by an active runtime loader", async () => {
    const event = defineDaemonWideModuleEvent<{ id: string }>(
      "concurrent-owner.event",
      ["id"],
    );
    const mod: KotaModule = {
      name: "concurrent-owner",
      events: [event],
      tools: [makeTool("concurrent_owner_tool")],
      onLoad: (ctx) => {
        ctx.registerMiddleware(
          "concurrent-owner-middleware",
          async (_call, next) => next(),
        );
        ctx.registerDynamicStateProvider(
          "concurrent-owner-state",
          () => "runtime-active",
        );
        ctx.registerHarnessHook({
          kind: "preRun",
          name: "concurrent-owner-hook",
          handler: () => {},
        });
      },
    };
    const runtime = createLoader({}, false, { mode: "runtime" });
    const commands = createLoader({}, false, { mode: "commands" });
    await runtime.load(mod);
    await commands.load(mod);

    const rejected = createLoader({}, false, { mode: "runtime" });
    await expect(rejected.load({
      ...mod,
      tools: [makeTool("partial_registration"), makeTool("concurrent_owner_tool")],
    })).rejects.toThrow("Tool already registered");
    await rejected.unloadAll();
    expect((await executeTool("partial_registration", {})).is_error).toBe(true);
    expect((await executeTool("concurrent_owner_tool", {})).content)
      .toBe("result from concurrent_owner_tool");
    expect(commands.getModuleSummaries()[0].toolNames).toEqual([]);

    await commands.unloadAll();

    expect((await executeTool("concurrent_owner_tool", {})).content)
      .toBe("result from concurrent_owner_tool");
    expect(getModuleEventRegistry()?.has(event.name)).toBe(true);
    expect(getToolMiddleware().list()).toContain("concurrent-owner-middleware");
    expect(collectDynamicState({ activeTools: new Set() })).toBe(
      "runtime-active",
    );
    expect(listHarnessHooks("preRun").map((hook) => hook.name))
      .toContain("concurrent-owner-hook");

    await runtime.unloadAll();
    expect((await executeTool("concurrent_owner_tool", {})).is_error).toBe(
      true,
    );
    expect(getModuleEventRegistry()?.has(event.name)).toBe(false);
    expect(getToolMiddleware().list()).not.toContain(
      "concurrent-owner-middleware",
    );
    expect(collectDynamicState({ activeTools: new Set() })).toBe("");
    expect(listHarnessHooks("preRun").map((hook) => hook.name))
      .not.toContain("concurrent-owner-hook");
  });

  it("withdraws only the selected module's executable contributions and disposes it once", async () => {
    const loader = createLoader({});
    const disposed: string[] = [];
    await loader.loadAll(["a", "b"].map((name): KotaModule => ({
      name, tools: [{ ...makeTool(name), group: "shared_group" }],
      onLoad: (ctx) => {
        ctx.registerDynamicStateProvider(`${name}-state`, () => name);
        ctx.registerHarnessHook({ kind: "preRun", name: `${name}-hook`, handler: () => {} });
        return { dispose: () => { disposed.push(name); } };
      },
    })));
    expect(collectDynamicState({ activeTools: new Set() })).toBe("ab");
    expect(TOOL_GROUPS.shared_group).toEqual(["a", "b"]);
    expect((await executeTool("a", {})).content).toBe("result from a");
    expect(await loader.unload("a")).toBe(true);
    expect(await loader.unload("a")).toBe(false);
    expect(disposed).toEqual(["a"]);
    expect(loader.getLoadedModules()).toEqual(["b"]);
    expect((await executeTool("a", {})).is_error).toBe(true);
    expect((await executeTool("b", {})).content).toBe("result from b");
    expect(collectDynamicState({ activeTools: new Set() })).toBe("b");
    expect(listHarnessHooks("preRun").map((hook) => hook.name)).toEqual(["b-hook"]);
    expect(TOOL_GROUPS.shared_group).toEqual(["b"]);
    await loader.unloadAll();
    expect(disposed).toEqual(["a", "b"]);
    expect(collectDynamicState({ activeTools: new Set() })).toBe("");
    expect(listHarnessHooks("preRun")).toEqual([]);
    expect(TOOL_GROUPS.shared_group).toBeUndefined();
  });

  it("replaces activated tool state and retains one copy of contributions across reload", async () => {
    const loader = createLoader({});
    let generation = 0;
    const disposed: number[] = [];
    await loader.load({
      name: "reloadable", configSlices: [fakeSlice("reloadable")],
      skills: [{ name: "guidance", promptPath: "src/core/modules/AGENTS.md" }],
      workflows: [{ repository: "read", name: "reloadable/job", triggers: [{ intervalMs: 1000 }],
        steps: [{ id: "noop", type: "code", run: () => {} }] }],
      channels: [{ name: "reloadable.channel", create: () => ({ status: "disabled", reason: "fixture" }) }],
      tools: () => {
        const version = ++generation;
        return [{ ...makeTool("version"), runner: async () => ({ content: String(version) }) }];
      },
      onLoad: () => {
        const version = generation;
        return { dispose: () => { disposed.push(version); } };
      },
    });
    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("### guidance");
    expect((await executeTool("version", {})).content).toBe("1");
    expect(await loader.reload("reloadable")).toBe(true);
    expect((await executeTool("version", {})).content).toBe("2");
    expect(disposed).toEqual([1]);
    expect(loader.getLoadedModules()).toEqual(["reloadable"]);
    expect([...loader.getRegisteredConfigKeys()]).toEqual(["reloadable"]);
    expect(loader.getSkillsPrompt()).toBe(prompt);
    expect(loader.getContributedWorkflows().map((entry) => entry.name)).toEqual(["reloadable/job"]);
    expect(loader.getContributedChannels().map((entry) => entry.name)).toEqual(["reloadable.channel"]);
    await loader.unload("reloadable");
    expect(disposed).toEqual([1, 2]);
    expect(loader.getRegisteredConfigKeys().size).toBe(0);
    expect(getRegisteredConfigSlice("reloadable")).toBeUndefined();
    expect(loader.getSkillsPrompt()).toBe("");
    expect(loader.getContributedWorkflows()).toEqual([]);
    expect(loader.getContributedChannels()).toEqual([]);
    expect(await loader.reload("reloadable")).toBe(false);
  });

});

describe("source reimport", () => {
  let tmpDir: string;
  let globalConfigPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-reimport-"));
    globalConfigPath = join(tmpDir, "machine-config.json");
    writeFileSync(
      globalConfigPath,
      JSON.stringify({ trustedScopes: [tmpDir] }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects failed installed reloads without reporting stale activation as success", async () => {
    const modDir = join(tmpDir, ".kota", "modules", "disk-mod");
    mkdirSync(modDir, { recursive: true });
    const manifestPath = join(modDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ name: "disk-mod", description: "original" }));
    const loader = createLoader({}, false, { globalConfigPath });
    loader.setCwd(tmpDir);
    const { reimportInstalledModule } = await import("./module-discovery.js");
    const mod = await reimportInstalledModule("disk-mod", tmpDir, { globalConfigPath });
    await loader.loadAll([], [mod!]);
    try {
      writeFileSync(manifestPath, "{");
      await expect(loader.reload("disk-mod")).rejects.toThrow();
      expect(loader.getLoadedModules()).toEqual(["disk-mod"]);
      writeFileSync(manifestPath, JSON.stringify({ name: "disk-mod", description: "updated" }));
      writeFileSync(globalConfigPath, "{}");
      await expect(loader.reload("disk-mod")).rejects.toThrow("cannot be reloaded");
      writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [tmpDir] }));
      expect(await loader.reload("disk-mod")).toBe(true);
    } finally {
      await loader.unloadAll();
    }
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

    const loader = createLoader({}, false, { globalConfigPath });
    loader.setCwd(tmpDir);

    const { reimportInstalledModule } = await import("./module-discovery.js");
    const mod = await reimportInstalledModule("disk-mod", tmpDir, {
      globalConfigPath,
    });
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

describe("module contribution snapshots", () => {
  it.each(["runtime", "commands"] as const)("keeps admitted discoveries stable in %s mode", async (mode) => {
    const { Command } = await import("commander");
    const loader = createLoader({}, false, { mode });
    const command = new Command("admitted");
    const route = { method: "GET" as const, path: "/admitted", handler: () => {} };
    let commands = [command];
    let routes = [route];
    try {
      await loader.load({ name: "snapshot", commands: () => commands, routes: () => routes });
      const summaries = loader.getModuleSummaries();
      expect(summaries).toMatchObject([{ commandNames: ["admitted"], routeSummaries: ["GET /admitted"] }]);
      commands = [new Command("unadmitted")];
      routes = [{ ...route, path: "/unadmitted" }];
      expect(loader.getCommands()).toEqual([command]);
      expect(loader.getModuleSummaries()).toEqual(summaries);
      if (mode === "runtime") expect(loader.getRoutes()).toEqual([route]);
      await loader.unload("snapshot");
      expect(loader.getCommands()).toEqual([]);
      expect(loader.getModuleSummaries()).toEqual([]);
      if (mode === "runtime") expect(loader.getRoutes()).toEqual([]);
    } finally { await loader.unloadAll(); }
  });

  it("exposes earlier admitted routes to a later module factory", async () => {
    const loader = createLoader({});
    const route = { method: "GET" as const, path: "/a", handler: () => {} };
    let earlierPaths: string[] = [];
    try {
      await loader.load({ name: "route-a", routes: () => [route] });
      await loader.load({ name: "route-b", routes: (ctx) => {
        earlierPaths = ctx.getRoutes().map((entry) => entry.path);
        return [{ ...route, path: "/b" }];
      } });
      expect(earlierPaths).toEqual(["/a"]);
      expect(loader.getRoutes().map((entry) => entry.path)).toEqual(["/a", "/b"]);
    } finally { await loader.unloadAll(); }
  });

  it("retains discovery failure without losing a healthy module or retrying on inspection", async () => {
    const loader = createLoader({});
    const route = { method: "GET" as const, path: "/ok", handler: () => {} };
    let failing = true;
    try {
      await loader.load({ name: "throws-mod", routes: () => {
        if (failing) throw new Error("bad routes");
        return [{ ...route, path: "/unadmitted" }];
      } });
      await loader.load({ name: "good-mod", routes: () => [route] });
      failing = false;
      expect(loader.getRoutes()).toEqual([route]);
      expect(loader.getModuleSummaries().find((entry) => entry.name === "throws-mod")?.routeError)
        .toBe("bad routes");
      expect(loader.getRoutes()).toEqual([route]);
    } finally { await loader.unloadAll(); }
  });
});

describe("Module SDK — storage, config, skills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("binds module configuration and isolated durable storage to the selected scope", async () => {
    const loader = createLoader({ modules: { a: { retries: 3 } } });
    loader.setCwd(tmpDir);
    for (const name of ["a", "b"]) {
      await loader.load({ name, onLoad: (ctx) => {
        expect(ctx.cwd).toBe(tmpDir);
        expect(ctx.getModuleConfig()).toEqual(name === "a" ? { retries: 3 } : undefined);
        ctx.storage.setText("same-key", name);
      } });
    }
    expect(loader.getModuleStorage("a")?.getText("same-key")).toBe("a");
    expect(loader.getModuleStorage("b")?.getText("same-key")).toBe("b");
    expect(loader.getModuleStorage("absent")).toBeUndefined();
    await loader.unload("a");
    expect(loader.getModuleStorage("a")).toBeUndefined();
    expect(loader.getModuleStorage("b")?.getText("same-key")).toBe("b");
    await loader.unloadAll();
    expect(loader.getModuleStorage("b")).toBeUndefined();
    const restarted = createLoader({});
    restarted.setCwd(tmpDir);
    await restarted.load({ name: "a" });
    expect(restarted.getModuleStorage("a")?.getText("same-key")).toBe("a");
    await restarted.unloadAll();
  });

  it.each(["commands", "runtime"] as const)("loads scoped skill content in contribution order in %s mode", async (mode) => {
    const loader = createLoader({}, false, { mode });
    loader.setCwd(tmpDir);
    try {
      for (const name of ["a", "b"]) {
        writeFileSync(join(tmpDir, `${name}.md`), `Guidance for ${name}.`);
        await loader.load({ name, skills: [{ name, promptPath: `${name}.md` }] });
      }
      expect(loader.getSkillsPrompt()).toMatch(/### a[\s\S]*Guidance for a\.[\s\S]*### b[\s\S]*Guidance for b\./);
      await loader.unload("a");
      expect(loader.getSkillsPrompt()).not.toContain("Guidance for a.");
      expect(loader.getSkillsPrompt()).toContain("Guidance for b.");
    } finally { await loader.unloadAll(); }
    expect(loader.getSkillsPrompt()).toBe("");
  });

  it("loads packaged module skill content outside the scope directory", async () => {
    const loader = createLoader({}, false);
    loader.setCwd(tmpDir);
    await loader.load({
      name: "packaged-guidance",
      skills: [{
        name: "packaged-guidance",
        promptPath: "src/core/modules/AGENTS.md",
      }],
    });

    const prompt = loader.getSkillsPrompt();
    expect(prompt).toContain("### packaged-guidance");
    expect(prompt).toContain(readFileSync("src/core/modules/AGENTS.md", "utf8").trim());
    await loader.unloadAll();
  });

  it("handles missing skill file gracefully", async () => {
    const chunks: string[] = [];
    captureDiagnostics(chunks);
    const loader = createLoader({});
    await loader.load({
      name: "broken-mod",
      skills: [{ name: "missing", promptPath: "nonexistent/skill.md" }],
    });

    expect(loader.getSkillsPrompt()).toBe("");
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Module "broken-mod" skill "missing" failed to load',
        ),
      ]),
    );
  });

  it("rejects module skill frontmatter tool-policy declarations", async () => {
    const skillPath = join(tmpDir, "restricted.md");
    writeFileSync(
      skillPath,
      "---\nname: restricted\ndisallowed-tools: [Bash]\n---\nRestricted guidance.",
    );
    const loader = createLoader({}, false);
    loader.setCwd(tmpDir);

    await expect(loader.load({
      name: "restricted-mod",
      skills: [{ name: "restricted", promptPath: "restricted.md" }],
    })).rejects.toThrow(
      'restricted.md: unsupported skill tool-policy frontmatter "disallowed-tools"',
    );
  });

});

describe("ctx.callTool — inherited tool invocation", () => {
  const invoke = <T>(run: () => T): T => withToolCallExecutionOptions({
    resultLimit: 30000, verbose: false, autonomyMode: "autonomous",
  }, run);
  it.each([
    ["missing_tool", "no registered input schema"],
    ["throws_tool", "boom"],
  ])("returns an observable error for %s and leaves later calls usable", async (name, message) => {
    const loader = createLoader({});
    try {
      await loader.load({ name: "provider", tools: [
        makeTool("healthy_tool"),
        { ...makeTool("throws_tool"), runner: async () => { throw new Error("boom"); } },
      ] });
      await loader.load({ name: "caller", onLoad: async (ctx) => {
        const result = await invoke(() => ctx.callTool(name, {}));
        expect(result.is_error).toBe(true);
        expect(result.content).toContain(message);
        expect((await invoke(() => ctx.callTool("healthy_tool", {}))).content).toBe("result from healthy_tool");
      } });
    } finally { await loader.unloadAll(); }
  });

  it("forwards chained input and results, bounds recursion, and recovers after depth exhaustion", async () => {
    const loader = createLoader({});
    try {
      await loader.load({ name: "chain", tools: (ctx) => [
        { ...makeTool("echo_tool"), runner: async (input) => ({ content: `echo: ${input.msg}` }) },
        { ...makeTool("chain_tool"), runner: async (input) => ctx.callTool("echo_tool", input) },
        { ...makeTool("recursive_tool"), runner: async () => ctx.callTool("recursive_tool", {}) },
      ] });
      await loader.load({ name: "caller", onLoad: async (ctx) => {
        for (const msg of ["first", "after recovery"]) {
          const exhausted = await invoke(() => ctx.callTool("recursive_tool", {}));
          expect(exhausted.is_error).toBe(true);
          expect(exhausted.content).toContain("depth limit exceeded");
          const result = await invoke(() => ctx.callTool("chain_tool", { msg }));
          expect(result.content).toBe(`echo: ${msg}`);
          expect(result.is_error).toBeFalsy();
        }
      } });
    } finally { await loader.unloadAll(); }
  });

  it("denies event callbacks without an active tool executor", async () => {
    const bus = new EventBus();
    const loader = new RuntimeModuleLoader({}, false, { mode: "runtime" });
    loader.setBus(bus);
    let resolveResult!: (result: ToolResult) => void;
    const result = new Promise<ToolResult>((resolve) => { resolveResult = resolve; });
    try {
      await loader.load({ name: "provider", tools: [makeTool("event_target")] });
      await loader.load({ name: "event-caller", onLoad: (ctx) => {
        ctx.events.subscribeExternal("test.trigger", async () => {
          resolveResult(await ctx.callTool("event_target", {}));
        });
      } });
      bus.emit("test.trigger", {});
      expect(await result).toMatchObject({ is_error: true, content: expect.stringContaining("active tool execution context") });
    } finally { await loader.unloadAll(); }
  });

  it("probeHealthChecks collects results from modules with healthCheck", async () => {
    const loader = createLoader({});
    await loader.load({
      name: "healthy-mod",
      healthCheck: () => ({ status: "healthy" }),
    });
    await loader.load({
      name: "degraded-mod",
      healthCheck: async () => ({
        status: "degraded",
        message: "token expiring",
      }),
    });
    await loader.load({ name: "no-check-mod" });

    const results = await loader.probeHealthChecks();
    expect(results["healthy-mod"]).toEqual({ status: "healthy" });
    expect(results["degraded-mod"]).toEqual({
      status: "degraded",
      message: "token expiring",
    });
    expect(results["no-check-mod"]).toBeUndefined();
  });

  it.each([
    ["thrown error", () => { throw new Error("boom"); }, "boom"],
    ["malformed result", () => ({ status: "future" }), "healthCheck result.status is invalid"],
  ] as const)("reports %s as unhealthy without losing healthy results", async (_label, healthCheck, message) => {
    const loader = createLoader({});
    await loader.load({ name: "broken", healthCheck: healthCheck as never });
    await loader.load({ name: "healthy", healthCheck: () => ({ status: "healthy" }) });
    expect(await loader.probeHealthChecks()).toEqual({
      broken: { status: "unhealthy", message: expect.stringContaining(message) },
      healthy: { status: "healthy" },
    });
    await loader.unloadAll();
  });

  it("rejects malformed lifecycle health before publishing module summaries", async () => {
    const loader = createLoader({});
    await loader.load({
      name: "malformed-lifecycle-health",
      getHealth: () => ({ status: "ok", restartCount: -1 }) as never,
    });

    expect(() => loader.getModuleSummaries()).toThrow(
      'Module "malformed-lifecycle-health" getHealth result.restartCount must be a non-negative safe integer',
    );
  });


  it("rejects duplicate configSlices across modules", async () => {
    const loader = createLoader({});
    const ownerSlice = fakeSlice("shared");
    await loader.load({
      name: "mod-a",
      configSlices: [ownerSlice],
    });
    await expect(
      loader.load({
        name: "mod-b",
        configSlices: [fakeSlice("shared")],
      }),
    ).rejects.toThrow(/already claimed by "mod-a"/);
    expect(getRegisteredConfigSlice("shared")).toBe(ownerSlice);
  });

  it("preserves a config-slice lease while another loader host still owns it", async () => {
    const slice = fakeSlice("sharedHostKey");
    const first = createLoader({}, false, { mode: "commands" });
    const second = createLoader({}, false, { mode: "commands" });

    await first.load({ name: "shared-config-owner", configSlices: [slice] });
    await second.load({ name: "shared-config-owner", configSlices: [slice] });
    await first.unload("shared-config-owner");

    expect(getRegisteredConfigSlice("sharedHostKey")).toBe(slice);
    await second.unload("shared-config-owner");
    expect(getRegisteredConfigSlice("sharedHostKey")).toBeUndefined();
  });

  it("adopts a re-imported config slice after the previous host releases its lease", async () => {
    const original = fakeSlice("reloadableKey");
    const disposeStructuralRegistration = registerConfigSlice(original, "reloadable-owner");
    onTestFinished(disposeStructuralRegistration);
    const loader = createLoader({}, false, { mode: "commands" });
    await loader.load({ name: "reloadable-owner", configSlices: [original] });
    await loader.unload("reloadable-owner");

    const reimported = fakeSlice("reloadableKey", "updated declaration");
    await loader.load({ name: "reloadable-owner", configSlices: [reimported] });

    expect(getRegisteredConfigSlice("reloadableKey")).toBe(reimported);
    await loader.unload("reloadable-owner");
    disposeStructuralRegistration();
    expect(getRegisteredConfigSlice("reloadableKey")).toBeUndefined();
  });

  it("keeps rejected duplicate identities out of structural config admission", () => {
    const bundledSlice = fakeSlice("identityOwnedKey", "bundled declaration");
    const installedSlice = fakeSlice("identityOwnedKey", "installed duplicate");
    const admission = admitDiscoveredModuleDefinitions(
      [{ name: "identity-owner", configSlices: [bundledSlice] }],
      [{ name: "identity-owner", configSlices: [installedSlice] }],
    );

    const dispose = registerAdmittedModuleConfigSlices(admission.admitted);
    onTestFinished(dispose);
    expect(admission.failures).toMatchObject([
      {
        name: "identity-owner",
        source: "installed",
      },
    ]);
    expect(getRegisteredConfigSlice("identityOwnedKey")).toBe(bundledSlice);

    dispose();
    expect(getRegisteredConfigSlice("identityOwnedKey")).toBeUndefined();
  });

  it("does not let a rejected loader host withdraw another module's config slice", async () => {
    const ownerSlice = fakeSlice("crossHostKey");
    const owner = createLoader({}, false, { mode: "commands" });
    const rejected = createLoader({}, false, { mode: "commands" });
    await owner.load({
      name: "valid-config-owner",
      configSlices: [ownerSlice],
    });

    await expect(rejected.load({
      name: "rejected-config-owner",
      configSlices: [fakeSlice("crossHostKey")],
    })).rejects.toThrow(/already claimed by module "valid-config-owner"/);

    expect(getRegisteredConfigSlice("crossHostKey")).toBe(ownerSlice);
  });

});
