import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import {
  chat,
  createDaemonSession,
  dangerousShellResponse,
  getSessionSnapshot,
  mockModuleMetadata,
  reloadConfig,
  type StartedDaemon,
  startDaemonWithLiveSessionReload,
  textResponse,
} from "./daemon-config-reload-live-session-support.integration.js";

const { mockStreamMessage } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
}));

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

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));

vi.mock("#core/model/streaming.js", () => ({
  streamMessage: mockStreamMessage,
}));

vi.mock("#core/loop/scope-context.js", () => ({
  loadScopeContext: vi.fn(() => ""),
}));

vi.mock("#core/loop/instruction-files.js", () => ({
  loadInstructionContext: vi.fn(() => ""),
}));

vi.mock("#root/init.js", () => ({
  buildSessionWarmup: vi.fn(() => ""),
}));

vi.mock("#core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() {
      return null;
    }
  },
}));

vi.mock("#core/modules/bundled-module-discovery.js", () => ({
  discoverBundledModules: vi.fn(async () => []),
}));

vi.mock("#core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

describe("daemon config reload live-session guardrails", () => {
  let subject: StartedDaemon | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEventBus();
    clearCustomTools();
    registerTool(
      {
        name: "shell",
        description: "Execute a command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
      async () => ({ content: "test command accepted" }),
    );
    mockModuleMetadata();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (subject) {
      await subject.server.stop();
      rmSync(subject.scopeRoot, { recursive: true, force: true });
      subject = null;
    }
    clearCustomTools();
    resetEventBus();
    vi.restoreAllMocks();
  });

  it("denies the next dangerous tool call in an existing session after daemon reload tightens guardrails", async () => {
    const permissiveGuardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
    };
    const strictGuardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    };
    subject = await startDaemonWithLiveSessionReload({
      reflection: false,
      guardrails: permissiveGuardrails,
      serve: { defaultAutonomyMode: "autonomous" },
    });
    const sessionId = await createDaemonSession(subject.port);
    const beforeSnapshot = await getSessionSnapshot(subject.port, sessionId);

    mockStreamMessage
      .mockResolvedValueOnce(dangerousShellResponse("tu-before"))
      .mockResolvedValueOnce(textResponse("before reload"));
    const firstEvents = await chat(
      subject.port,
      sessionId,
      "run the destructive command once",
    );
    expect(firstEvents.find((event) => event.event === "guardrail")?.data)
      .toMatchObject({ tool: "shell", risk: "dangerous", policy: "allow" });

    const reload = await reloadConfig(subject.port, {
      reflection: false,
      guardrails: strictGuardrails,
      serve: { defaultAutonomyMode: "autonomous" },
    });
    expect(reload.sessionGuardrails).toEqual({
      refreshed: 1,
      unchanged: 0,
      nonRefreshable: [],
    });
    const reloadedSnapshot = await getSessionSnapshot(subject.port, sessionId);
    expect(reloadedSnapshot.id).not.toBe(beforeSnapshot.id);
    expect(reloadedSnapshot.generation).toBe(beforeSnapshot.generation + 1);

    mockStreamMessage
      .mockResolvedValueOnce(dangerousShellResponse("tu-after"))
      .mockResolvedValueOnce(textResponse("after reload"));
    const secondEvents = await chat(
      subject.port,
      sessionId,
      "run the same destructive command again",
    );

    expect(secondEvents.find((event) => event.event === "guardrail")?.data)
      .toMatchObject({ tool: "shell", risk: "dangerous", policy: "deny" });
  });

  it("does not churn the session guardrails snapshot on a module-only reload", async () => {
    const guardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    };
    subject = await startDaemonWithLiveSessionReload({
      reflection: false,
      guardrails,
      serve: { defaultAutonomyMode: "autonomous" },
      modules: { git: { token: "old" } },
    });
    const sessionId = await createDaemonSession(subject.port);
    const beforeSnapshot = await getSessionSnapshot(subject.port, sessionId);

    const reload = await reloadConfig(subject.port, {
      reflection: false,
      guardrails,
      serve: { defaultAutonomyMode: "autonomous" },
      modules: { git: { token: "new" } },
    });

    expect(reload.changedModules).toEqual(["git", "github"]);
    expect(reload.sessionGuardrails).toEqual({
      refreshed: 0,
      unchanged: 1,
      nonRefreshable: [],
    });
    await expect(getSessionSnapshot(subject.port, sessionId))
      .resolves.toEqual(beforeSnapshot);
  });
});
