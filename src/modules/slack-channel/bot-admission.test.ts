import { describe, expect, it, vi } from "vitest";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import {
  AgentSession,
  MockWebSocket,
  makeBot,
  makeStubClients,
  setupSlackBotTestHooks,
} from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot interactive admission", () => {
  it("rejects unauthorized input before slash commands, inbound signals, or sessions", async () => {
    const clients = makeStubClients();
    const events = { emit: vi.fn() };
    const bot = makeBot({
      ...clients,
      allowedUserIds: ["U-OWNER"],
      inboundSignals: {
        getScopeId: () => "scope-slack",
        config: { prefixes: ["!task"], trustedUserIds: ["U-OWNER"] },
        events,
      },
    });
    const startPromise = bot.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    ws.simulateMessage({
      type: "events_api",
      envelope_id: "env-user-denied",
      payload: {
        team_id: "T-TEST",
        event: {
          type: "message",
          text: "/tasks open",
          user: "U-INTRUDER",
          channel: "D-INTRUDER",
          channel_type: "im",
        },
      },
    });
    ws.simulateMessage({
      type: "events_api",
      envelope_id: "env-workspace-denied",
      payload: {
        team_id: "T-OTHER",
        event: {
          type: "message",
          text: "!task capture secret",
          user: "U-OWNER",
          channel: "D-OWNER",
          channel_type: "im",
        },
      },
    });
    ws.simulateMessage({
      type: "events_api",
      envelope_id: "env-channel-denied",
      payload: {
        team_id: "T-TEST",
        event: {
          type: "message",
          text: "open a session",
          user: "U-OWNER",
          channel: "C-PUBLIC",
          channel_type: "channel",
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(clients.tasks.list).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(AgentSession).not.toHaveBeenCalled();

    bot.stop();
    await startPromise.catch(() => {});
  });

  it("keeps admitted-user authorization separate from inbound actor trust", async () => {
    const events = { emit: vi.fn() };
    const bot = makeBot({
      allowedUserIds: ["U-OWNER"],
      inboundSignals: {
        getScopeId: () => "scope-slack",
        config: { prefixes: ["!task"], trustedUserIds: ["U-TRUSTED"] },
        events,
      },
    });
    const startPromise = bot.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].simulateMessage({
      type: "events_api",
      envelope_id: "env-admitted-untrusted",
      payload: {
        team_id: "T-TEST",
        event: {
          type: "message",
          text: "!task inspect this",
          user: "U-OWNER",
          channel: "D-OWNER",
          channel_type: "im",
        },
      },
    });

    await vi.waitFor(() => expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      expect.objectContaining({
        actor: expect.objectContaining({ trust: "untrusted" }),
      }),
    ));
    expect(AgentSession).not.toHaveBeenCalled();

    bot.stop();
    await startPromise.catch(() => {});
  });

  it("rejects callbacks from another user or workspace before approval mutation", async () => {
    const reject = vi.fn();
    const bot = makeBot({
      allowedUserIds: ["U-OWNER"],
      approvals: { ...makeStubClients().approvals, reject },
    });
    const startPromise = bot.start();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    const interaction = {
      type: "block_actions",
      actions: [{ action_id: "reject:xyz", value: "reject:xyz" }],
      channel: { id: "C1" },
      message: { ts: "1234.5678" },
    };

    ws.simulateMessage({
      type: "interactive",
      envelope_id: "env-interactive-user-denied",
      payload: {
        ...interaction,
        team: { id: "T-TEST" },
        user: { id: "U-INTRUDER", name: "Intruder" },
      },
    });
    ws.simulateMessage({
      type: "interactive",
      envelope_id: "env-interactive-workspace-denied",
      payload: {
        ...interaction,
        team: { id: "T-OTHER" },
        user: { id: "U-OWNER", name: "Owner" },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reject).not.toHaveBeenCalled();

    bot.stop();
    await startPromise.catch(() => {});
  });
});
