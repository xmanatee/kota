import { afterEach, beforeEach, type Mock, vi } from "vitest";
import type { AnswerClient } from "#modules/answer/client.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import { SlackBot } from "./bot.js";
import type {
  AttentionSnapshotClient,
  DigestSnapshotClient,
} from "./commands.js";

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
    callSlackApi: vi.fn().mockResolvedValue({}),
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

export function makeStubClients(): {
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
  retract: RetractClient;
  memory: MemoryClient;
  knowledge: KnowledgeClient;
  history: HistoryClient;
  tasks: RepoTasksClient;
  attention: AttentionSnapshotClient;
  digest: DigestSnapshotClient;
  approvals: ApprovalsClient;
} {
  return {
    recall: { recall: vi.fn() },
    answer: { answer: vi.fn(), log: vi.fn(), show: vi.fn() },
    capture: { capture: vi.fn() },
    retract: { retract: vi.fn() },
    memory: {
      list: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
    knowledge: {
      list: vi.fn(),
      show: vi.fn(),
      search: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      reindex: vi.fn(),
    },
    history: {
      list: vi.fn(),
      listDiscoveredProjectRecords: vi.fn(),
      show: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
    tasks: {
      list: vi.fn(),
      show: vi.fn(),
      move: vi.fn(),
      create: vi.fn(),
      capture: vi.fn(),
      gc: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
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
  return new SlackBot({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    notifyChannel: "C-NOTIFY",
    autonomyMode: "supervised",
    ...makeStubClients(),
    ...overrides,
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
    mockedCallSlackApi.mockResolvedValue({} as never);
    mockedOpenSocketModeUrl.mockReset();
    mockedOpenSocketModeUrl.mockResolvedValue("wss://fake.slack.com/ws");
    agentSessionMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

type SlackPostMessage = { channel?: string; text?: string };

export function findPostMessage(channelId: string): SlackPostMessage | null {
  const calls = mockedCallSlackApi.mock.calls.filter(
    (call) => call[1] === "chat.postMessage" &&
      (call[2] as { channel?: string }).channel === channelId,
  );
  const last = calls[calls.length - 1];
  return last ? (last[2] as SlackPostMessage) : null;
}

export async function sendSlashAndAwait(
  channelId: string,
  text: string,
  ws: MockWebSocket,
  envelope: string,
): Promise<SlackPostMessage> {
  ws.simulateMessage({
    type: "events_api",
    envelope_id: envelope,
    payload: { event: { type: "message", text, user: "U-SLASH", channel: channelId } },
  });
  await vi.waitFor(() => {
    if (!findPostMessage(channelId)) throw new Error("no chat.postMessage yet");
  });
  return findPostMessage(channelId)!;
}
