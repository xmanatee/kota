import { afterEach, beforeEach, type Mock, vi } from "vitest";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import { SlackBot } from "./bot.js";
import type { SlackCommandClients } from "./commands.js";

type SlackTransportMockInstance = {
  emit: Mock;
  flush: Mock;
  getBuffer: Mock;
};

type AgentSessionMockInstance = {
  send: Mock;
  close: Mock;
};

type NullTransportMockInstance = { emit: Mock };
type ProxyTransportMockInstance = { target: null; emit: Mock };

// Mock external dependencies at module level
vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  const SlackTransport = vi.fn(function (this: SlackTransportMockInstance) {
    this.emit = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
    this.getBuffer = vi.fn().mockReturnValue("");
  });
  return {
    ...actual,
    callSlackApi: vi.fn().mockResolvedValue({ channel: "C1", ts: "1234.5678" }),
    openSocketModeUrl: vi.fn().mockResolvedValue("wss://fake.slack.com/ws"),
    SlackTransport,
    RECONNECT_DELAY_MS: 0,
  };
});

const agentSessionMock = vi.hoisted(() =>
  vi.fn(function (this: AgentSessionMockInstance) {
    this.send = vi.fn().mockResolvedValue("");
    this.close = vi.fn();
  }),
);

vi.mock("#core/loop/loop.js", () => ({ AgentSession: agentSessionMock }));

vi.mock("#core/loop/transport.js", () => {
  const NullTransport = vi.fn(function (this: NullTransportMockInstance) {
    this.emit = vi.fn();
  });
  const ProxyTransport = vi.fn(function (this: ProxyTransportMockInstance) {
    this.target = null;
    this.emit = vi.fn();
  });
  return { NullTransport, ProxyTransport };
});

import { callSlackApi, openSocketModeUrl } from "./client.js";

export const mockedCallSlackApi = vi.mocked(callSlackApi);
export const mockedOpenSocketModeUrl = vi.mocked(openSocketModeUrl);

export function approvalProjection(id = "abc123") {
  return {
    id,
    scopeId: "scope-test",
    kind: "tool_call" as const,
    tool: "shell",
    input: { redacted: true as const, reason: "tool-io" as const },
    review: {
      status: "available" as const,
      input: { command: "deploy --target /srv/app" },
      context: "user: deploy the client release",
      digest: "a".repeat(64),
    },
    risk: "dangerous" as const,
    reason: "Runs commands",
    createdAt: "2026-07-28T22:00:00.000Z",
    status: "pending" as const,
  };
}

export function makeStubClients(): SlackCommandClients & { approvals: ApprovalsClient } {
  return {
    recall: { recall: vi.fn() },
    answer: { answer: vi.fn(), log: vi.fn(), show: vi.fn() },
    capture: { capture: vi.fn() },
    retract: { retract: vi.fn() },
    memory: { search: vi.fn() },
    knowledge: { search: vi.fn() },
    history: { search: vi.fn() },
    tasks: { search: vi.fn() },
    attention: { snapshot: vi.fn().mockReturnValue({ text: "" }) },
    digest: { snapshot: vi.fn().mockReturnValue({ text: "" }) },
    approvals: {
      list: vi.fn(async () => ({ approvals: [] })),
      approve: vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "approved" as const },
        resolution: {
          kind: "tool_execution" as const,
          execution: {
            status: "succeeded" as const,
            output: { redacted: true as const, reason: "tool-io" as const },
          },
        },
      })),
      reject: vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "rejected" as const },
      })),
    },
  };
}

export function makeBot(overrides?: Partial<ConstructorParameters<typeof SlackBot>[0]>) {
  const { approvals, ...clients } = makeStubClients();
  const { getApprovals, ...optionOverrides } = overrides ?? {};
  const runtime = {
    scope: {
      scopeId: "test-scope",
      scopeRoot: "/tmp/test-scope",
      displayName: "Test Project",
    },
  } as ScopeRuntime;
  return new SlackBot({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    workspaceId: "T-TEST",
    allowedUserIds: ["U1", "U2", "U-SLASH", "U-FREE"],
    notifyChannel: "C-NOTIFY",
    autonomyMode: "supervised",
    getDefaultScopeRuntime: () => runtime,
    ...clients,
    getApprovals: getApprovals ?? (() => approvals),
    ...optionOverrides,
  });
}

// --- WebSocket mock ---

type WsEvent = { data?: string; code?: number };
type WsListener = (event: WsEvent) => void;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  private listeners: Record<string, WsListener[]> = {};
  readyState = 1; // OPEN

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Fire open asynchronously
    queueMicrotask(() => this.fire("open", {}));
  }

  addEventListener(event: string, handler: WsListener) {
    (this.listeners[event] ??= []).push(handler);
  }

  send: Mock = vi.fn();
  close: Mock = vi.fn().mockImplementation(() => {
    this.fire("close", { code: 1000 });
  });

  fire(event: string, data: WsEvent) {
    for (const handler of this.listeners[event] ?? []) {
      handler(data);
    }
  }

  simulateMessage(payload: object) {
    this.fire("message", { data: JSON.stringify(payload) });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}


export { agentSessionMock as AgentSession, SlackBot };

export function setupSlackBotTestHooks(): void {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockedCallSlackApi.mockReset();
    mockedCallSlackApi.mockResolvedValue({ channel: "C1", ts: "1234.5678" } as never);
    mockedOpenSocketModeUrl.mockReset();
    mockedOpenSocketModeUrl.mockResolvedValue("wss://fake.slack.com/ws");
    agentSessionMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
