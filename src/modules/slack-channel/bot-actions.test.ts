import { describe, expect, it, vi } from "vitest";
import { AgentSession, approvalProjection, MockWebSocket, makeBot, makeStubClients, mockedCallSlackApi, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("message handling", () => {
    it("sends busy message when user already has an in-flight request", async () => {
      // Make agent.send block to simulate a long-running request
      const sendBlocker = new Promise<string>(() => {}); // never resolves
      vi.mocked(AgentSession).mockImplementation(
        function (this: Record<string, unknown>) {
          this.send = vi.fn().mockReturnValue(sendBlocker);
          this.close = vi.fn();
        } as never,
      );

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      // First message — starts processing (blocks)
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "msg1", user: "U1", channel: "D1" } },
      });

      // Let the first message start processing
      await new Promise((r) => setTimeout(r, 50));

      // Second message from same user — should get busy response
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-2",
        payload: { event: { type: "message", text: "msg2", user: "U1", channel: "D1" } },
      });

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.postMessage",
          expect.objectContaining({ text: expect.stringContaining("Still working") }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- handleBlockAction ---

  describe("handleBlockAction", () => {
    it("submits the reviewed digest and updates the message on approve action", async () => {
      const mockApprove = vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "approved" as const },
        execution: {
          status: "succeeded" as const,
          output: { redacted: true as const, reason: "tool-io" as const },
        },
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, approve: mockApprove },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{
            action_id: "approve:abc",
            value: `approve:abc:${"a".repeat(64)}`,
          }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(mockApprove).toHaveBeenCalledWith(
        "abc",
        "a".repeat(64),
      ));

      // Verify message update
      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            channel: "C1",
            ts: "1234.5678",
            text: expect.stringContaining("Approved and executed"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("reports an approved operation whose execution failed", async () => {
      const mockApprove = vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "approved" as const },
        execution: {
          status: "failed" as const,
          output: { redacted: true as const, reason: "tool-io" as const },
        },
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, approve: mockApprove },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

      MockWebSocket.instances[0].simulateMessage({
        type: "interactive",
        envelope_id: "env-failed-execution",
        payload: {
          type: "block_actions",
          actions: [{
            action_id: "approve:failed",
            value: `approve:failed:${"a".repeat(64)}`,
          }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            text: expect.stringContaining("Approved, but execution failed"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("calls the approval client reject seam and updates the message", async () => {
      const mockReject = vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), tool: "write", status: "rejected" as const },
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, reject: mockReject },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "reject:def", value: "reject:def" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(mockReject).toHaveBeenCalledWith("def"));

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            text: expect.stringContaining("Rejected"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("shows a stale-review message when approval is already resolved", async () => {
      const mockApprove = vi.fn(async () => ({
        ok: false as const,
        reason: "not_found" as const,
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, approve: mockApprove },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{
            action_id: "approve:gone",
            value: `approve:gone:${"a".repeat(64)}`,
          }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            text: expect.stringContaining("changed, is unavailable, or was already resolved"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("skips actions without a recognized verb", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "unknown:abc", value: "unknown:abc" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      // chat.update should NOT be called for unknown verbs
      expect(mockedCallSlackApi).not.toHaveBeenCalledWith(
        expect.any(String),
        "chat.update",
        expect.anything(),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- Session management ---

});
