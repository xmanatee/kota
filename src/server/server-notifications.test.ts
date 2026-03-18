import { describe, expect, it, vi } from "vitest";
import type { ActionExecutor, ActionResult } from "../scheduler/action-executor.js";
import type { ScheduledItem } from "../scheduler/scheduler.js";
import { NotificationHub } from "./server-notifications.js";
import type { SseTransport } from "./session-pool.js";

function mockSseClient(closed = false): SseTransport & { sentEvents: Array<{ name: string; data: unknown }> } {
  const sentEvents: Array<{ name: string; data: unknown }> = [];
  return {
    isClosed: closed,
    send: (name: string, data: Record<string, unknown>) => sentEvents.push({ name, data }),
    emit: vi.fn(),
    end: vi.fn(),
    sentEvents,
  } as unknown as SseTransport & { sentEvents: Array<{ name: string; data: unknown }> };
}

function makeItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    id: 1,
    description: "Test item",
    triggerAt: "2026-01-01T00:00:00Z",
    status: "pending",
    created: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockExecutor(canExec = true): ActionExecutor {
  return {
    canExecute: () => canExec,
    execute: vi.fn(async (item: ScheduledItem) => ({
      item,
      result: "done",
      durationMs: 100,
    })),
    activeCount: 0,
  } as unknown as ActionExecutor;
}

describe("NotificationHub", () => {
  describe("broadcast", () => {
    it("sends to all connected clients", () => {
      const hub = new NotificationHub();
      const c1 = mockSseClient();
      const c2 = mockSseClient();
      hub.addClient(c1);
      hub.addClient(c2);

      hub.broadcast({ type: "test", message: "hello" });

      expect(c1.sentEvents).toHaveLength(1);
      expect(c1.sentEvents[0]).toEqual({ name: "notification", data: { type: "test", message: "hello" } });
      expect(c2.sentEvents).toHaveLength(1);
    });

    it("removes closed clients during broadcast", () => {
      const hub = new NotificationHub();
      const alive = mockSseClient(false);
      const dead = mockSseClient(true);
      hub.addClient(alive);
      hub.addClient(dead);

      hub.broadcast({ type: "test" });

      expect(alive.sentEvents).toHaveLength(1);
      expect(dead.sentEvents).toHaveLength(0);
      expect(hub.clientCount).toBe(1);
    });

    it("handles zero clients without error", () => {
      const hub = new NotificationHub();
      expect(() => hub.broadcast({ type: "test" })).not.toThrow();
    });
  });

  describe("broadcastActionResult", () => {
    it("broadcasts formatted action result", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);

      const result: ActionResult = {
        item: makeItem({ id: 42, description: "Deploy", action: "npm deploy" }),
        result: "Deployed successfully",
        durationMs: 500,
      };

      hub.broadcastActionResult(result);

      expect(client.sentEvents).toHaveLength(1);
      const data = client.sentEvents[0].data as Record<string, unknown>;
      expect(data.type).toBe("action_result");
      expect(data.id).toBe(42);
      expect(data.description).toBe("Deploy");
      expect(data.action).toBe("npm deploy");
      expect(data.result).toBe("Deployed successfully");
      expect(data.error).toBeNull();
      expect(data.durationMs).toBe(500);
    });

    it("includes error in result when present", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);

      const result: ActionResult = {
        item: makeItem(),
        result: "",
        error: "Command failed",
        durationMs: 50,
      };

      hub.broadcastActionResult(result);

      const data = client.sentEvents[0].data as Record<string, unknown>;
      expect(data.error).toBe("Command failed");
    });
  });

  describe("handleDueItems", () => {
    it("broadcasts reminders for notification-only items", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);
      const executor = mockExecutor();

      hub.handleDueItems([makeItem({ id: 5, description: "Meeting", repeatLabel: "daily" })], executor);

      expect(client.sentEvents).toHaveLength(1);
      const data = client.sentEvents[0].data as Record<string, unknown>;
      expect(data.type).toBe("reminder");
      expect(data.id).toBe(5);
      expect(data.description).toBe("Meeting");
      expect(data.repeat).toBe("daily");
    });

    it("executes action items and broadcasts action_started", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);
      const executor = mockExecutor(true);

      hub.handleDueItems([makeItem({ id: 10, action: "npm test", description: "Run tests" })], executor);

      expect(executor.execute).toHaveBeenCalledOnce();
      const started = client.sentEvents.find((e) => (e.data as Record<string, unknown>).type === "action_started");
      expect(started).toBeTruthy();
      expect((started!.data as Record<string, unknown>).action).toBe("npm test");
    });

    it("broadcasts action_skipped when executor is at capacity", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);
      const executor = mockExecutor(false); // can't execute

      hub.handleDueItems([makeItem({ id: 7, action: "deploy", description: "Deploy app" })], executor);

      expect(executor.execute).not.toHaveBeenCalled();
      const skipped = client.sentEvents.find((e) => (e.data as Record<string, unknown>).type === "action_skipped");
      expect(skipped).toBeTruthy();
      expect((skipped!.data as Record<string, unknown>).reason).toBe("Too many concurrent actions");
    });

    it("handles mixed notifications and actions in one batch", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);
      const executor = mockExecutor(true);

      hub.handleDueItems([
        makeItem({ id: 1, description: "Reminder" }),
        makeItem({ id: 2, description: "Action", action: "do stuff" }),
      ], executor);

      const types = client.sentEvents.map((e) => (e.data as Record<string, unknown>).type);
      expect(types).toContain("reminder");
      expect(types).toContain("action_started");
      expect(executor.execute).toHaveBeenCalledOnce();
    });

    it("handles empty due items without error", () => {
      const hub = new NotificationHub();
      const executor = mockExecutor();

      expect(() => hub.handleDueItems([], executor)).not.toThrow();
      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  describe("client management", () => {
    it("addClient / removeClient tracks correctly", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();

      hub.addClient(client);
      expect(hub.clientCount).toBe(1);

      hub.removeClient(client);
      expect(hub.clientCount).toBe(0);
    });

    it("removeClient is safe for unknown client", () => {
      const hub = new NotificationHub();
      expect(() => hub.removeClient(mockSseClient())).not.toThrow();
    });
  });
});
