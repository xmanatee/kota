import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { outboundHttp } from "#core/outbound-http/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import { channelSessionFixture } from "#root/channel-session-test-support.js";
import { SlackBot } from "./bot.js";
import type { SlackCommandClients } from "./commands.js";

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return { ...actual, callSlackApi: vi.fn(actual.callSlackApi), openSocketModeUrl: vi.fn(actual.openSocketModeUrl), RECONNECT_DELAY_MS: 0 };
});

export let sessions: ReturnType<typeof channelSessionFixture>;
const bots: SlackBot[] = [];
export const httpRequests: Array<{ method: string; body: Record<string, unknown> }> = [];

import { callSlackApi, openSocketModeUrl } from "./client.js";

export const mockedCallSlackApi = vi.mocked(callSlackApi);
export const mockedOpenSocketModeUrl = vi.mocked(openSocketModeUrl);
const productionCall = mockedCallSlackApi.getMockImplementation()!;
const productionOpen = mockedOpenSocketModeUrl.getMockImplementation()!;

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
  const runtime = sessions.runtime();
  const bot = new SlackBot({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    workspaceId: "T-TEST",
    allowedUserIds: ["U1", "U2", "U-SLASH", "U-FREE"],
    notifyChannel: "C-NOTIFY",
    autonomyMode: "supervised",
    model: "openai/controlled",
    moduleLoader: sessions.loader,
    getDefaultScopeRuntime: () => runtime,
    ...clients,
    getApprovals: getApprovals ?? (() => approvals),
    ...optionOverrides,
  });
  bots.push(bot);
  return bot;
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


export { SlackBot };

export function setupSlackBotTestHooks(): void {
  beforeEach(() => {
    sessions = channelSessionFixture();
    httpRequests.length = 0;
    vi.spyOn(outboundHttp, "request").mockImplementation(outboundHttpRequestPort((request) => {
      httpRequests.push({ method: String(request.url).split("/").at(-1)!, body: JSON.parse(String(request.body ?? "{}")) });
      return Response.json({ ok: true, channel: "C1", ts: "1234.5678", url: "wss://fake.slack.com/ws" });
    }).request);
    MockWebSocket.reset();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockedCallSlackApi.mockReset();
    mockedCallSlackApi.mockImplementation(productionCall);
    mockedOpenSocketModeUrl.mockReset();
    mockedOpenSocketModeUrl.mockImplementation(productionOpen);
  });

  afterEach(async () => {
    for (const bot of bots.splice(0)) bot.stop();
    await sessions.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}
