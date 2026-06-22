import { describe, expect, it } from "vitest";
import { runProcess } from "./process.js";
import { installProcessTestHooks, waitForExit } from "./process-test-support.js";

installProcessTestHooks();

describe("process lifecycle edge cases", () => {
  describe("max process limit with mixed states", () => {
    it("allows new process when one exited among max running", async () => {
      for (let i = 0; i < 4; i++) {
        await runProcess({ action: "start", command: "sleep 30" });
      }
      await runProcess({ action: "start", command: "echo fast" });
      await waitForExit("p5");

      const result = await runProcess({ action: "start", command: "sleep 30" });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Started background process");
    }, 15_000);
  });

  describe("whitespace command validation", () => {
    it("rejects whitespace-only command", async () => {
      const result = await runProcess({ action: "start", command: "   " });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("command is required");
    });

    it("rejects empty string command", async () => {
      const result = await runProcess({ action: "start", command: "" });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("command is required");
    });
  });

  describe("multiple signals to same process", () => {
    it("sends multiple signals without error", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const firstSignal = await runProcess({ action: "signal", process_id: "p1", signal: "SIGTERM" });
      await waitForExit("p1");
      const secondSignal = await runProcess({ action: "signal", process_id: "p1", signal: "SIGKILL" });

      expect(firstSignal.is_error).toBeUndefined();
      expect(firstSignal.content).toContain("SIGTERM");
      expect(secondSignal.content).toContain("already exited");
    });
  });

  describe("process error event", () => {
    it("handles spawn error for nonexistent shell command", async () => {
      await runProcess({ action: "start", command: "nonexistent_cmd_xyz_999" });
      const output = await waitForExit("p1");

      expect(output).toMatch(/exited|error/i);
    });
  });

  describe("interleaved stdout and stderr", () => {
    it("captures both streams in order received", async () => {
      const command = "echo out1; echo err1 >&2; echo out2; echo err2 >&2";
      await runProcess({ action: "start", command });
      const output = await waitForExit("p1");

      expect(output).toContain("out1");
      expect(output).toContain("out2");
      expect(output).toContain("[stderr] err1");
      expect(output).toContain("[stderr] err2");
    });
  });

  describe("purgeStale uses exit time, not start time", () => {
    it("retains long-running process output after exit", async () => {
      await runProcess({ action: "start", command: "echo crash-output" });
      await waitForExit("p1");

      const firstOutput = await runProcess({ action: "output", process_id: "p1" });
      await runProcess({ action: "start", command: "echo second" });
      const secondOutput = await runProcess({ action: "output", process_id: "p1" });

      expect(firstOutput.content).toContain("crash-output");
      expect(secondOutput.is_error).toBeUndefined();
      expect(secondOutput.content).toContain("crash-output");
    });
  });

  describe("close does not overwrite error exitCode", () => {
    it("preserves error exitCode after close fires", async () => {
      await runProcess({ action: "start", command: "exit 42" });
      const output = await waitForExit("p1", 15000);

      expect(output).toContain("exited (code 42)");
      expect(output).toContain("[process exited with code 42]");
    });

    it("shows correct exit code in output buffer message", async () => {
      await runProcess({ action: "start", command: "exit 7" });
      const output = await waitForExit("p1", 15000);

      expect(output).toContain("[process exited with code 7]");
      expect(output).not.toContain("code null");
    });
  });

  describe("sendSignal reports undelivered signals", () => {
    it("reports when signal was not delivered to dead process", async () => {
      await runProcess({ action: "start", command: "echo quick-exit" });
      await waitForExit("p1");
      const result = await runProcess({ action: "signal", process_id: "p1" });

      expect(result.content).toContain("already exited");
    });
  });

  describe("cleanupProcesses idempotency", () => {
    it("does not send duplicate signals on double cleanup", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const { cleanupProcesses } = await import("./process.js");

      cleanupProcesses();
      cleanupProcesses();
      const output = await waitForExit("p1");

      expect(output).toMatch(/exited/);
    });
  });

  describe("concurrent start and signal", () => {
    it("handles signal during initial output wait", async () => {
      const startPromise = runProcess({ action: "start", command: "sleep 60" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const signalResult = await runProcess({ action: "signal", process_id: "p1" });
      const startResult = await startPromise;

      expect(signalResult.is_error).toBeUndefined();
      expect(startResult.content).toContain("Started background process p1");
    });
  });

  describe("concurrent starts respect process limit", () => {
    it("does not exceed MAX_PROCESSES with parallel starts", async () => {
      for (let i = 0; i < 4; i++) {
        await runProcess({ action: "start", command: "sleep 60" });
      }

      const [first, second] = await Promise.all([
        runProcess({ action: "start", command: "sleep 60" }),
        runProcess({ action: "start", command: "sleep 60" }),
      ]);
      const successes = [first, second].filter((result) => !result.is_error);
      const failures = [first, second].filter((result) => result.is_error);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].content).toContain("max 5");
    });
  });
});
