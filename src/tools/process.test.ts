import { afterEach, describe, expect, it } from "vitest";
import { clearProcesses, getActiveProcessCount, runProcess } from "./process.js";

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

  describe("circular buffer", () => {
    it("evicts oldest lines when buffer exceeds 500", async () => {
      // Generate 510 lines — first 10 should be evicted
      const cmd = "for i in $(seq 1 510); do echo line_$i; done";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 1500));
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
      // Each line is ~110 chars, 250 lines ≈ 27500 chars > 20000 limit
      const cmd = "for i in $(seq 1 250); do printf 'X%.0s' $(seq 1 100); echo; done";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 1500));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 500 });
      expect(result.content).toContain("truncated");
    });
  });

  describe("cross-module: dangerous command blocking", () => {
    it("blocks dangerous commands in non-TTY environment", async () => {
      const result = await runProcess({ action: "start", command: "sudo rm -rf /" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("blocked");
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
      await new Promise((r) => setTimeout(r, 600));
      // Now only 4 are active, so a 6th start should succeed
      const result = await runProcess({ action: "start", command: "sleep 30" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Started background process");
    });
  });

  describe("output lines clamping", () => {
    it("clamps requested lines to valid range", async () => {
      await runProcess({ action: "start", command: "for i in $(seq 1 5); do echo line_$i; done" });
      await new Promise((r) => setTimeout(r, 600));
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
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "list" });
      // The "last:" line should be truncated with ...
      const lastMatch = result.content!.match(/last: (.+)/);
      expect(lastMatch).toBeTruthy();
      expect(lastMatch![1]).toContain("...");
      expect(lastMatch![1].length).toBeLessThanOrEqual(80);
    });
  });

  describe("chunk boundary handling", () => {
    it("preserves blank lines in output", async () => {
      // printf with explicit newlines to produce blank lines
      const cmd = "printf 'line1\\n\\nline3\\n'";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
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
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      // The two printf calls should be joined into one line
      expect(result.content).toContain("partial_complete");
    });

    it("flushes partial stdout line on process exit", async () => {
      // printf without trailing newline — data stays in partial buffer until close
      const cmd = "printf 'no-newline-at-end'";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      expect(result.content).toContain("no-newline-at-end");
    });

    it("flushes partial stderr line on process exit", async () => {
      const cmd = "printf 'stderr-no-nl' >&2";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      expect(result.content).toContain("[stderr] stderr-no-nl");
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
      await new Promise((r) => setTimeout(r, 400));
      // Second signal to already-exited process should report exited
      const r2 = await runProcess({ action: "signal", process_id: "p1", signal: "SIGKILL" });
      expect(r2.content).toContain("already exited");
    });
  });

  describe("process error event", () => {
    it("handles spawn error for nonexistent shell command", async () => {
      // Spawning a nonexistent binary directly (not via sh -c) would trigger error
      // But since we use sh -c, the shell itself runs — the exit code captures failure
      const result = await runProcess({ action: "start", command: "nonexistent_cmd_xyz_999" });
      // The process will start (shell runs) but the command inside will fail
      await new Promise((r) => setTimeout(r, 600));
      const output = await runProcess({ action: "output", process_id: "p1" });
      // Should show either an error message or a non-zero exit code
      expect(output.content).toMatch(/exited|error/i);
    });
  });

  describe("interleaved stdout and stderr", () => {
    it("captures both streams in order received", async () => {
      const cmd = "echo out1; echo err1 >&2; echo out2; echo err2 >&2";
      await runProcess({ action: "start", command: cmd });
      await new Promise((r) => setTimeout(r, 600));
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      expect(result.content).toContain("out1");
      expect(result.content).toContain("out2");
      expect(result.content).toContain("[stderr] err1");
      expect(result.content).toContain("[stderr] err2");
    });
  });

  describe("output with no lines produced", () => {
    it("shows (no output) for process with empty output", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });
      expect(result.content).toContain("(no output)");
    });
  });
});
