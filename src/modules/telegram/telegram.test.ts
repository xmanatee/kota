import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  resolveAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { CapabilityReadinessSource } from "#core/daemon/capability-readiness.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { KotaClient } from "#core/server/kota-client.js";
import telegramModule, {
  TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
} from "./index.js";

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    callTelegramApi: vi.fn(),
  };
});

vi.mock("./callback-poll.js", () => ({
  createTelegramCallbackHandler: vi.fn(() => async () => false),
  startCallbackPoll: vi.fn(() => () => {}),
}));

function makeTestHarness(name: string): AgentHarness {
  return {
    name,
    description: `${name} test harness`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: name === "codex" ? "native" : "kota",
    unsupportedRunOptions: [],
    async run() {
      return {
        text: "ok",
        streamedText: "ok",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      };
    },
  };
}

vi.mock("#core/agent-harness/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/agent-harness/index.js")>();
  return {
    ...actual,
    resolveAgentHarness: vi.fn((name: string) => makeTestHarness(name)),
  };
});

const mockOwnerQueueGet = vi.fn();
vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: () => ({ get: mockOwnerQueueGet }),
}));

const mockedResolveAgentHarness = vi.mocked(resolveAgentHarness);

const TEST_PROJECT: ConfiguredProject = {
  projectId: "test-project",
  projectDir: "/tmp/test",
  displayName: "KOTA",
};

function makeStubClient(
  overrides: Partial<KotaClient> = {},
): KotaClient {
  const client = {
    projects: {
      list: vi.fn(async () => ({
        ok: true as const,
        defaultProjectId: TEST_PROJECT.projectId,
        activeProjectId: null,
        projects: [TEST_PROJECT],
      })),
      use: vi.fn(),
    },
    ownerQuestions: {
      list: vi.fn(async () => ({ questions: [] })),
      answer: vi.fn(),
      dismiss: vi.fn(),
    },
  } as Partial<KotaClient>;
  client.forProject = vi.fn(() => client as KotaClient);
  Object.assign(client, overrides);
  return client as KotaClient;
}

function makeStubCtx(
  bus?: EventBus,
  client: KotaClient = makeStubClient(),
  config: ModuleRuntimeContext["config"] = {} as ModuleRuntimeContext["config"],
): ModuleRuntimeContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp",
    verbose: false,
    config,
    storage: new ModuleStorage("/tmp/test", "telegram"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
      getContributedUiSurfaces: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: (key) => process.env[key] ?? null,
    listTools: () => [],
    events: makeStubEventProxy(b),
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
    client,
  };
}

describe("telegramModule", () => {
  beforeEach(() => {
    mockedResolveAgentHarness.mockReset();
    mockedResolveAgentHarness.mockImplementation((name: string) =>
      makeTestHarness(name),
    );
  });

  it("has correct metadata", () => {
    expect(telegramModule.name).toBe("telegram");
    expect(telegramModule.version).toBe("1.0.0");
    expect(telegramModule.description).toContain("Telegram");
  });

  it("does not register a standalone CLI command", () => {
    expect(telegramModule.commands).toBeUndefined();
  });

  it("does not register tools or routes", () => {
    expect(telegramModule.tools).toBeUndefined();
    expect(telegramModule.routes).toBeUndefined();
  });

  it("declares dependencies", () => {
    expect(telegramModule.dependencies).toEqual([
      "answer",
      "approval-queue",
      "autonomy",
      "capture",
      "daemon-ops",
      "history",
      "inbound-signals",
      "knowledge",
      "memory",
      "model-clients",
      "recall",
      "repo-tasks",
      "retract",
      "secrets",
      "transcription",
    ]);
  });

  it("declares separate setup for bot credentials and interactive backend readiness", () => {
    const setupRequirements = telegramModule.setupRequirements;
    if (!setupRequirements || typeof setupRequirements === "function") {
      throw new Error("telegram setup requirements must be static");
    }

    const credentialRequirement = setupRequirements.find((req) =>
      req.id === "bot-credentials"
    );
    const backendRequirement = setupRequirements.find((req) =>
      req.id === "interactive-model-backend"
    );
    expect(credentialRequirement?.kind).toBe("secret");
    expect(backendRequirement).toMatchObject({
      kind: "capability",
      capabilityIds: [TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID],
    });
    const manifest = telegramModule.manifest;
    if (!manifest || typeof manifest === "function") {
      throw new Error("telegram manifest must be static");
    }
    const interactiveCapability = manifest.capabilities.find(
      (capability) => capability.id === "telegram.interactive",
    );
    expect(interactiveCapability?.setupRequirementIds).toEqual([
      "bot-credentials",
      "interactive-model-backend",
    ]);
  });

  it("reports the default Codex backend as ready through setup capability readiness", async () => {
    const savedPreset = process.env.KOTA_PRESET;
    delete process.env.KOTA_PRESET;
    const readiness = { source: null as CapabilityReadinessSource | null };
    const ctx = makeStubCtx(
      undefined,
      makeStubClient(),
      {
        model: "gpt-5.6-sol",
        serve: { defaultAutonomyMode: "passive" },
      } as ModuleRuntimeContext["config"],
    );
    ctx.registerProvider = <T,>(_token: unknown, provider: T): void => {
      readiness.source = provider as unknown as CapabilityReadinessSource;
    };

    telegramModule.onLoad!(ctx);
    try {
      const source = readiness.source;
      if (!source) throw new Error("readiness source not registered");
      const reports = await source.probe();
      expect(reports).toEqual([
        expect.objectContaining({
          id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
          status: "ready",
          reason: "harness_ready",
          message: expect.stringContaining("codex"),
        }),
      ]);
    } finally {
      if (savedPreset !== undefined) process.env.KOTA_PRESET = savedPreset;
      else delete process.env.KOTA_PRESET;
      await telegramModule.onUnload?.();
    }
  });});
