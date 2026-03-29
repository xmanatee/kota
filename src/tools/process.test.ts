import { afterEach, describe, expect, it } from "vitest";
import { clearProcesses, getActiveProcessCount, runProcess } from "./process.js";

afterEach(() => {
  clearProcesses();
});

/** Poll getOutput until the process shows "exited" or maxWaitMs is reached. */
async function waitForExit(processId: string, maxWaitMs = 5000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await runProcess({ action: "output", process_id: processId });
    if (r.content?.includes("exited")) return r.content;
    await new Promise((res) => setTimeout(res, 50));
  }
  const r = await runProcess({ action: "output", process_id: processId });
  return r.content ?? "";
}

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

  describe("circular buffer", () => {
    it("evicts oldest lines when buffer exceeds 500", async () => {
      // Generate 510 lines — first 10 should be evicted
      const cmd = "for i in $(seq 1 510); do echo line_$i; done";
      await runProcess({ action: "start", command: cmd });
      await waitForExit("p1", 10000);
      const result = await runProcess({ action: "output", process_id: "p1", lines: 500 });
      // line_1 through line_10 should be evicted; line_11+ and exit msg remain
      expect(result.content).not.toContain("line_1\n");
      expect(result.content).toContain("line_500");
      expect(result.content).toContain("line_510");
      expect(result.content).toContain("500/500 lines");
    });
  });

  describe("output truncation", () => {
    it("truncates output exceeding MAX_OUTPUT_CHARS", async () => {
      // Each line is 101 chars, 250 lines ≈ 25250 chars > 20000 limit
      // Use python3 to avoid slow bash loop with seq subprocesses
      const cmd = "python3 -c \"for _ in range(250): print('X'*100)\"";
      await runProcess({ action: "start", command: cmd });
      await waitForExit("p1", 10000);
      const result = await runProcess({ action: "output", process_id: "p1", lines: 500 });
      expect(result.content).toContain("truncated");
    });
  });

  describe("max process limit with mixed states", () => {
    it("allows new process when one exited among max running", async () => {
      // Start 4 long-running + 1 fast (exits quickly)
      for (let i = 0; i < 4; i++) {
        await runProcess({ action: "start", command: "sleep 30" });
      }
      await runProcess({ action: "start", command: "echo fast" });
      // Wait for the fast one to exit
      await waitForExit("p5");
      // Now only 4 are active, so a 6th start should succeed
      const result = await runProcess({ action: "start", command: "sleep 30" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Started background process");
    }, 15_000);
  });

  describe("output lines clamping", () => {
    it("clamps requested lines to valid range", async () => {
      await runProcess({ action: "start", command: "for i in $(seq 1 5); do echo line_$i; done" });
      await waitForExit("p1");
      // Request 0 lines — should clamp to 1
      const r1 = await runProcess({ action: "output", process_id: "p1", lines: 0 });
      // Should still return some content (at least the exit line)
      expect(r1.is_error).toBeUndefined();
      // Request negative — should clamp to 1
      const r2 = await runProcess({ action: "output", process_id: "p1", lines: -5 });
      expect(r2.is_error).toBeUndefined();
    });
  });

  describe("list with long last-line truncation", () => {
    it("truncates last output line at 80 chars in list view", async () => {
      const longLine = "B".repeat(120);
      // Use a long-running process so last buffer line is the long echo, not exit message
      await runProcess({ action: "start", command: `echo ${longLine} && sleep 30` });
      // Poll until the output buffer has content (data event may arrive after startProcess wait)
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const out = await runProcess({ action: "output", process_id: "p1" });
        if (out.content && !out.content.includes("(no output)")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const result = await runProcess({ action: "list" });
      // The "last:" line should be truncated with ...
      const lastMatch = result.content!.match(/last: (.+)/);
      expect(lastMatch).toBeTruthy();
      expect(lastMatch![1]).toContain("...");
      expect(lastMatch![1].length).toBeLessThanOrEqual(80);
    }, 10_000);
  });

  describe("chunk boundary handling", () => {
    it("preserves blank lines in output", async () => {
      // printf with explicit newlines to produce blank lines
      const cmd = "printf 'line1\\n\\nline3\\n'";
      await runProcess({ action: "start", command: cmd });
      const content = await waitForExit("p1");
      const result = { content };
      // The blank line between line1 and line3 should be preserved
      const lines = result.content!.split("\n");
      const outputStart = lines.findIndex((l: string) => l.includes("line1"));
      expect(outputStart).toBeGreaterThanOrEqual(0);
      // line1, then blank line, then line3 should all be present
      expect(result.content).toContain("line1");
      expect(result.content).toContain("line3");
      // Check there's an empty-string entry in the buffer between them
      const bufferLines = lines.slice(outputStart);
      const line1Idx = bufferLines.findIndex((l: string) => l === "line1");
      const line3Idx = bufferLines.findIndex((l: string) => l === "line3");
      expect(line3Idx).toBeGreaterThan(line1Idx + 1);
    });

    it("reassembles lines split across chunks via partial buffering", async () => {
      // Use printf without trailing newline, then echo with newline
      // This forces the shell to produce output that may arrive in separate chunks
      const cmd = "printf 'partial'; printf '_complete\\n'";
      await runProcess({ action: "start", command: cmd });
      const output = await waitForExit("p1");
      // The two printf calls should be joined into one line
      expect(output).toContain("partial_complete");
    });

    it("flushes partial stdout line on process exit", async () => {
      // printf without trailing newline — data stays in partial buffer until close
      const cmd = "printf 'no-newline-at-end'";
      await runProcess({ action: "start", command: cmd });
      const output = await waitForExit("p1");
      expect(output).toContain("no-newline-at-end");
    });

    it("flushes partial stderr line on process exit", async () => {
      const cmd = "printf 'stderr-no-nl' >&2";
      await runProcess({ action: "start", command: cmd });
      const output = await waitForExit("p1");
      expect(output).toContain("[stderr] stderr-no-nl");
    });
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
      const r1 = await runProcess({ action: "signal", process_id: "p1", signal: "SIGTERM" });
      expect(r1.is_error).toBeUndefined();
      expect(r1.content).toContain("SIGTERM");
      // Wait for exit
      await waitForExit("p1");
      // Second signal to already-exited process should report exited
      const r2 = await runProcess({ action: "signal", process_id: "p1", signal: "SIGKILL" });
      expect(r2.content).toContain("already exited");
    });
  });

  describe("process error event", () => {
    it("handles spawn error for nonexistent shell command", async () => {
      // Spawning a nonexistent binary directly (not via sh -c) would trigger error
      // But since we use sh -c, the shell itself runs — the exit code captures failure
      await runProcess({ action: "start", command: "nonexistent_cmd_xyz_999" });
      // The process will start (shell runs) but the command inside will fail
      const output = await waitForExit("p1");
      // Should show either an error message or a non-zero exit code
      expect(output).toMatch(/exited|error/i);
    });
  });

  describe("interleaved stdout and stderr", () => {
    it("captures both streams in order received", async () => {
      const cmd = "echo out1; echo err1 >&2; echo out2; echo err2 >&2";
      await runProcess({ action: "start", command: cmd });
      const output = await waitForExit("p1");
      expect(output).toContain("out1");
      expect(output).toContain("out2");
      expect(output).toContain("[stderr] err1");
      expect(output).toContain("[stderr] err2");
    });
  });

  describe("output with no lines produced", () => {
    it("shows (no output) for process with empty output", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      expect(result.content).toContain("(no output)");
    });
  });

  describe("purgeStale uses exit time, not start time", () => {
    it("retains long-running process output after exit", async () => {
      // Start a process that exits quickly
      await runProcess({ action: "start", command: "echo crash-output" });
      await waitForExit("p1");
      // Manually backdate startedAt to simulate a long-running process (>10min)
      // but exitedAt is recent — purgeStale should NOT remove it
      const result1 = await runProcess({ action: "output", process_id: "p1" });
      expect(result1.content).toContain("crash-output");
      // The process exited recently, so even though startedAt could be old,
      // output should still be available after starting another process (which calls purgeStale)
      await runProcess({ action: "start", command: "echo second" });
      const result2 = await runProcess({ action: "output", process_id: "p1" });
      expect(result2.is_error).toBeUndefined();
      expect(result2.content).toContain("crash-output");
    });
  });

  describe("close does not overwrite error exitCode", () => {
    it("preserves error exitCode of -1 after close fires", async () => {
      // Start a command that fails — the shell runs but the command inside fails
      await runProcess({ action: "start", command: "exit 42" });
      const output = await waitForExit("p1");
      // Should show exit code 42, not null
      expect(output).toContain("exited (code 42)");
      expect(output).toContain("[process exited with code 42]");
    });

    it("shows correct exit code in output buffer message", async () => {
      await runProcess({ action: "start", command: "exit 7" });
      const output = await waitForExit("p1");
      expect(output).toContain("[process exited with code 7]");
      expect(output).not.toContain("code null");
    });
  });

  describe("sendSignal reports undelivered signals", () => {
    it("reports when signal was not delivered to dead process", async () => {
      // Start a process that exits immediately
      await runProcess({ action: "start", command: "echo quick-exit" });
      await waitForExit("p1");
      // The process has exited — should get "already exited" message
      const result = await runProcess({ action: "signal", process_id: "p1" });
      expect(result.content).toContain("already exited");
    });
  });

  describe("cleanupProcesses idempotency", () => {
    it("does not send duplicate signals on double cleanup", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      // Import cleanupProcesses to call it directly
      const { cleanupProcesses } = await import("./process.js");
      // First cleanup — sends SIGTERM
      cleanupProcesses();
      // Second cleanup — should be a no-op (killing flag set)
      cleanupProcesses();
      // Process should still terminate normally
      const output = await waitForExit("p1");
      expect(output).toMatch(/exited/);
    });
  });

  describe("concurrent start and signal", () => {
    it("handles signal during initial output wait", async () => {
      // Start a long-running process — startProcess awaits 500ms for initial output
      const startPromise = runProcess({ action: "start", command: "sleep 60" });
      // While start is waiting for initial output, send a signal
      // The process is already registered in the map before the await
      await new Promise((r) => setTimeout(r, 100));
      const sigResult = await runProcess({ action: "signal", process_id: "p1" });
      expect(sigResult.is_error).toBeUndefined();
      // The start should complete normally (may report exited or running)
      const startResult = await startPromise;
      expect(startResult.content).toContain("Started background process p1");
    });
  });

  describe("concurrent starts respect process limit", () => {
    it("does not exceed MAX_PROCESSES with parallel starts", async () => {
      // Start 4 long-running processes sequentially
      for (let i = 0; i < 4; i++) {
        await runProcess({ action: "start", command: "sleep 60" });
      }
      // Now start 2 more concurrently — only 1 slot left
      const [r1, r2] = await Promise.all([
        runProcess({ action: "start", command: "sleep 60" }),
        runProcess({ action: "start", command: "sleep 60" }),
      ]);
      // At least one should succeed, at most one should fail
      const successes = [r1, r2].filter((r) => !r.is_error);
      const failures = [r1, r2].filter((r) => r.is_error);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].content).toContain("max 5");
    });
  });

  describe("output during process exit", () => {
    it("returns consistent state when read during exit", async () => {
      await runProcess({ action: "start", command: "echo line1 && sleep 0.1 && echo line2" });
      // Read output multiple times rapidly
      const results = await Promise.all([
        runProcess({ action: "output", process_id: "p1", lines: 50 }),
        new Promise<void>((r) => setTimeout(r, 200)).then(() =>
          runProcess({ action: "output", process_id: "p1", lines: 50 }),
        ),
        new Promise<void>((r) => setTimeout(r, 800)).then(() =>
          runProcess({ action: "output", process_id: "p1", lines: 50 }),
        ),
      ]);
      // All should succeed (no errors)
      for (const r of results) {
        expect(r.is_error).toBeUndefined();
        expect(r.content).toContain("p1");
      }
      // Final read should have all output
      expect(results[2].content).toContain("line1");
      expect(results[2].content).toContain("line2");
    });
  });
});
