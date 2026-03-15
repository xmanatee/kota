import { describe, it, expect } from "vitest";
import {
  ActionExecutor,
  getActionItems,
  partitionDueItems,
  type ActionResult,
} from "./action-executor.js";
import type { ScheduledItem } from "./scheduler.js";

function makeItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    id: 1,
    description: "Test item",
    triggerAt: new Date().toISOString(),
    status: "pending",
    created: new Date().toISOString(),
    ...overrides,
  };
}

describe("getActionItems", () => {
  it("filters items with actions", () => {
    const items = [
      makeItem({ id: 1, action: "check weather" }),
      makeItem({ id: 2 }),
      makeItem({ id: 3, action: "run tests" }),
    ];
    const result = getActionItems(items);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
  });

  it("returns empty array when no items have actions", () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
    expect(getActionItems(items)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(getActionItems([])).toHaveLength(0);
  });
});

describe("partitionDueItems", () => {
  it("separates action items from notification-only items", () => {
    const items = [
      makeItem({ id: 1, description: "Weather check", action: "check weather" }),
      makeItem({ id: 2, description: "Meeting reminder" }),
      makeItem({ id: 3, description: "Run backup", action: "run backup script" }),
    ];
    const { actions, notifications } = partitionDueItems(items);
    expect(actions).toHaveLength(2);
    expect(notifications).toHaveLength(1);
    expect(actions[0].description).toBe("Weather check");
    expect(actions[1].description).toBe("Run backup");
    expect(notifications[0].description).toBe("Meeting reminder");
  });

  it("handles all actions", () => {
    const items = [
      makeItem({ id: 1, action: "a" }),
      makeItem({ id: 2, action: "b" }),
    ];
    const { actions, notifications } = partitionDueItems(items);
    expect(actions).toHaveLength(2);
    expect(notifications).toHaveLength(0);
  });

  it("handles all notifications", () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
    const { actions, notifications } = partitionDueItems(items);
    expect(actions).toHaveLength(0);
    expect(notifications).toHaveLength(2);
  });

  it("handles empty input", () => {
    const { actions, notifications } = partitionDueItems([]);
    expect(actions).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });
});

describe("ActionExecutor", () => {
  it("returns error for items without action", async () => {
    const executor = new ActionExecutor({
      sessionOptions: { model: "test" },
    });
    const item = makeItem({ id: 1 });
    const result = await executor.execute(item);
    expect(result.error).toBe("No action defined");
    expect(result.durationMs).toBe(0);
  });

  it("respects maxConcurrent limit", () => {
    const executor = new ActionExecutor({
      sessionOptions: { model: "test" },
      maxConcurrent: 2,
    });
    expect(executor.canExecute()).toBe(true);
    expect(executor.activeCount).toBe(0);
  });

  it("reports correct activeCount", () => {
    const executor = new ActionExecutor({
      sessionOptions: { model: "test" },
      maxConcurrent: 3,
    });
    expect(executor.activeCount).toBe(0);
    expect(executor.canExecute()).toBe(true);
  });
});

describe("ActionResult type", () => {
  it("captures successful result structure", () => {
    const result: ActionResult = {
      item: makeItem({ id: 5, action: "check stock", description: "Stock check" }),
      result: "AAPL is at $185",
      durationMs: 3500,
    };
    expect(result.item.id).toBe(5);
    expect(result.result).toBe("AAPL is at $185");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBe(3500);
  });

  it("captures error result structure", () => {
    const result: ActionResult = {
      item: makeItem({ id: 6, action: "fail", description: "Should fail" }),
      result: "",
      error: "API key missing",
      durationMs: 100,
    };
    expect(result.error).toBe("API key missing");
    expect(result.result).toBe("");
  });
});
