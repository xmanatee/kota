import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runSchedule } from "./schedule.js";
import { initScheduler, resetScheduler } from "../scheduler.js";

describe("schedule tool", () => {
  beforeEach(() => {
    initScheduler("/test", null); // in-memory
  });

  afterEach(() => {
    resetScheduler();
  });

  it("adds a scheduled reminder", async () => {
    const result = await runSchedule({
      action: "add",
      description: "Check deployment",
      time: "in 30 minutes",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("#1");
    expect(result.content).toContain("Check deployment");
  });

  it("adds with repeat", async () => {
    const result = await runSchedule({
      action: "add",
      description: "Health check",
      time: "in 5 minutes",
      repeat: "every 30 minutes",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("every 30 minutes");
  });

  it("rejects missing description", async () => {
    const result = await runSchedule({ action: "add", time: "in 5 minutes" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("description");
  });

  it("rejects missing time", async () => {
    const result = await runSchedule({
      action: "add",
      description: "Test",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("time");
  });

  it("rejects unparseable time", async () => {
    const result = await runSchedule({
      action: "add",
      description: "Test",
      time: "whenever",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("could not parse");
  });

  it("rejects unparseable repeat", async () => {
    const result = await runSchedule({
      action: "add",
      description: "Test",
      time: "in 5 minutes",
      repeat: "sometimes",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("could not parse repeat");
  });

  it("lists pending items", async () => {
    await runSchedule({
      action: "add",
      description: "Task A",
      time: "in 30 minutes",
    });
    await runSchedule({
      action: "add",
      description: "Task B",
      time: "in 1 hour",
    });

    const result = await runSchedule({ action: "list" });
    expect(result.content).toContain("2 scheduled");
    expect(result.content).toContain("Task A");
    expect(result.content).toContain("Task B");
  });

  it("shows empty list", async () => {
    const result = await runSchedule({ action: "list" });
    expect(result.content).toContain("No scheduled items");
  });

  it("cancels an item", async () => {
    await runSchedule({
      action: "add",
      description: "Cancelme",
      time: "in 30 minutes",
    });
    const result = await runSchedule({ action: "cancel", id: 1 });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Cancelled");

    const list = await runSchedule({ action: "list" });
    expect(list.content).toContain("No scheduled items");
  });

  it("cancel fails for non-existent id", async () => {
    const result = await runSchedule({ action: "cancel", id: 999 });
    expect(result.is_error).toBe(true);
  });

  it("rejects unknown action", async () => {
    const result = await runSchedule({ action: "unknown" });
    expect(result.is_error).toBe(true);
  });
});
