import { describe, it, expect, afterEach } from "vitest";
import { runProcess, clearProcesses, getActiveProcessCount } from "./process.js";

afterEach(() => {
  clearProcesses();
});

describe("process tool", () => {
  describe("start action", () => {
    it("starts a background process and returns its ID", async () => {
      const result = await runProcess({ action: "start", command: "echo hello" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Started background process p1");
      expect(result.content).toContain("echo hello");
    });

    it("requires command for start", async () => {
      const result = await runProcess({ action: "start" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("command is required");
    });

    it("captures initial output", async () => {
      const result = await runProcess({ action: "start", command: "echo 'server ready'" });
      expect(result.content).toContain("server ready");
    });

    it("increments process IDs", async () => {
      const r1 = await runProcess({ action: "start", command: "echo a" });
      const r2 = await runProcess({ action: "start", command: "echo b" });
      expect(r1.content).toContain("p1");
      expect(r2.content).toContain("p2");
    });

    it("enforces max concurrent process limit", async () => {
      // Start 5 long-running processes
      for (let i = 0; i < 5; i++) {
        await runProcess({ action: "start", command: "sleep 30" });
      }
      const result = await runProcess({ action: "start", command: "echo overflow" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("max 5");
    });

    it("allows new process after previous ones exit", async () => {
      // Start a process that exits quickly
      await runProcess({ action: "start", command: "echo quick" });
      // Wait for it to exit
      await new Promise((r) => setTimeout(r, 200));
      expect(getActiveProcessCount()).toBe(0);
    });
  });

  describe("output action", () => {
    it("returns output from a running process", async () => {
      await runProcess({ action: "start", command: "echo line1 && echo line2 && echo line3" });
      await new Promise((r) => setTimeout(r, 300));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 10 });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("line1");
      expect(result.content).toContain("line2");
      expect(result.content).toContain("line3");
    });

    it("errors on unknown process ID", async () => {
      const result = await runProcess({ action: "output", process_id: "p999" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("unknown process");
    });

    it("shows exit status for completed processes", async () => {
      await runProcess({ action: "start", command: "echo done" });
      await new Promise((r) => setTimeout(r, 300));
      const result = await runProcess({ action: "output", process_id: "p1" });
      expect(result.content).toContain("exited");
    });
  });

  describe("signal action", () => {
    it("sends SIGTERM to a running process", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const result = await runProcess({ action: "signal", process_id: "p1" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("SIGTERM");
    });

    it("sends specified signal", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const result = await runProcess({
        action: "signal", process_id: "p1", signal: "SIGKILL",
      });
      expect(result.content).toContain("SIGKILL");
    });

    it("reports already-exited processes", async () => {
      await runProcess({ action: "start", command: "echo fast" });
      await new Promise((r) => setTimeout(r, 300));
      const result = await runProcess({ action: "signal", process_id: "p1" });
      expect(result.content).toContain("already exited");
    });

    it("errors on unknown process ID", async () => {
      const result = await runProcess({ action: "signal", process_id: "p999" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("unknown process");
    });
  });

  describe("list action", () => {
    it("returns empty message when no processes", async () => {
      const result = await runProcess({ action: "list" });
      expect(result.content).toContain("No managed processes");
    });

    it("lists running and exited processes", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      await runProcess({ action: "start", command: "echo quick" });
      await new Promise((r) => setTimeout(r, 300));
      const result = await runProcess({ action: "list" });
      expect(result.content).toContain("p1");
      expect(result.content).toContain("p2");
      expect(result.content).toContain("sleep 60");
      expect(result.content).toContain("echo quick");
    });
  });

  describe("unknown action", () => {
    it("returns error for unknown action", async () => {
      const result = await runProcess({ action: "bogus" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("unknown action");
    });
  });

  describe("stderr capture", () => {
    it("captures stderr with prefix", async () => {
      await runProcess({ action: "start", command: "echo err >&2" });
      await new Promise((r) => setTimeout(r, 300));
      const result = await runProcess({ action: "output", process_id: "p1" });
      expect(result.content).toContain("[stderr]");
      expect(result.content).toContain("err");
    });
  });
});
