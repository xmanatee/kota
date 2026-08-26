import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectSessionEnvironmentVariable,
  sessionEnvironmentForExecution,
} from "#core/tools/session-environment.js";

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("./scope-context.js", () => ({
  loadScopeContext: vi.fn(() => ""),
}));
vi.mock("./instruction-files.js", () => ({
  loadInstructionContext: vi.fn(() => ""),
}));
vi.mock("#root/init.js", () => ({
  buildSessionWarmup: vi.fn(() => ""),
}));
vi.mock("#core/tools/delegate.js", () => ({
  setDelegateConfig: vi.fn(),
  delegateTool: {
    name: "delegate",
    description: "",
    input_schema: { type: "object", properties: {} },
  },
}));
vi.mock("#core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
  getTaskStore: vi.fn(() => ({
    add: vi.fn(),
    update: vi.fn(),
    list: vi.fn(() => []),
    active: vi.fn(() => []),
    get: vi.fn(),
    clear: vi.fn(),
    archiveCompleted: vi.fn(() => 0),
    getActiveSummary: vi.fn(() => null),
    isEmpty: vi.fn(() => true),
    count: vi.fn(() => 0),
  })),
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

import { AgentSession } from "./loop.js";

describe("AgentSession credential environment", () => {
  let session: AgentSession | undefined;

  afterEach(() => {
    session?.close();
    vi.restoreAllMocks();
  });

  it("registers the scoped overlay and erases it on close", () => {
    session = new AgentSession({ autonomyMode: "autonomous" });
    const identity = {
      sessionId: session.sessionId,
      scopeId: session.scopeId,
    };
    injectSessionEnvironmentVariable(
      identity,
      "KOTA_LOOP_SESSION_SECRET",
      "temporary-value",
    );
    expect(sessionEnvironmentForExecution(identity)).toEqual({
      KOTA_LOOP_SESSION_SECRET: "temporary-value",
    });

    session.close();

    expect(sessionEnvironmentForExecution(identity)).toEqual({});
  });
});
