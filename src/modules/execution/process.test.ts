import { describe, expect, it } from "vitest";
import {
  injectSessionEnvironmentVariable,
  registerSessionEnvironment,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";
import { getActiveProcessCount, runProcess } from "./process.js";
import { envProbeCommand, installProcessTestHooks, waitForExit } from "./process-test-support.js";

installProcessTestHooks();

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

    it("captures initial partial output before a long-running process exits", async () => {
      const result = await runProcess({ action: "start", command: "printf 'server booting'; sleep 30" });

      expect(result.content).toContain("server booting");
    });

    it("truncates oversized initial partial output before newline or exit", async () => {
      const result = await runProcess({
        action: "start",
        command: "python3 -c \"import sys,time; sys.stdout.write('X'*25000); sys.stdout.flush(); time.sleep(30)\"",
      });

      expect(result.content).toContain("Initial output:");
      expect(result.content).toContain("truncated");
      expect(result.content!.length).toBeLessThan(20_000);
    }, 10_000);

    it("injects context ids and scrubs inherited telemetry routing env", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://kota-collector";
      process.env.OTLP_ENDPOINT = "http://legacy-collector";

      const result = await runProcess(
        { action: "start", command: envProbeCommand },
        { sessionId: "session-bg", toolUseId: "tool-bg" },
      );

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("session-bg|tool-bg|missing|missing");
    });

    it("does not synthesize correlation ids for no-context direct calls", async () => {
      process.env.KOTA_SESSION_ID = "parent-session";
      process.env.KOTA_TOOL_USE_ID = "parent-tool";

      const result = await runProcess({ action: "start", command: envProbeCommand });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("missing|missing|missing|missing");
    });

    it("terminates a credential-bearing process when its session tears down", async () => {
      const context = {
        sessionId: "session-bg-secret",
        scopeId: "scope-bg-secret",
      };
      registerSessionEnvironment(context);
      try {
        injectSessionEnvironmentVariable(
          context,
          "KOTA_BACKGROUND_PROCESS_SECRET",
          "background-secret",
        );

        const result = await runProcess(
          {
            action: "start",
            command:
              "printf '%s' \"${KOTA_BACKGROUND_PROCESS_SECRET-missing}\"; sleep 30",
          },
          context,
        );
        expect(result.content).toContain("background-secret");
        expect(getActiveProcessCount()).toBe(1);

        await unregisterSessionEnvironment(context);

        expect(await waitForExit("p1")).toContain("exited");
        expect(getActiveProcessCount()).toBe(0);
      } finally {
        await unregisterSessionEnvironment(context);
      }
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
      // Poll until it shows as exited (close event may arrive slightly after the startProcess wait)
      await waitForExit("p1");
      expect(getActiveProcessCount()).toBe(0);
    }, 10_000);
  });

  describe("output action", () => {
    it("returns output from a running process", async () => {
      await runProcess({ action: "start", command: "echo line1 && echo line2 && echo line3" });
      await waitForExit("p1");
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
      await waitForExit("p1");
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
      await waitForExit("p1");
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
      await waitForExit("p2");
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
      await waitForExit("p1");
      const result = await runProcess({ action: "output", process_id: "p1" });
      expect(result.content).toContain("[stderr]");
      expect(result.content).toContain("err");
    });
  });
});
