import { describe, expect, it } from "vitest";
import { runProcess } from "./process.js";
import { installProcessTestHooks, waitForExit } from "./process-test-support.js";

installProcessTestHooks();

describe("process output buffers", () => {
  describe("circular buffer", () => {
    it("evicts oldest lines when buffer exceeds 500", async () => {
      const command = "for i in $(seq 1 510); do echo line_$i; done";
      await runProcess({ action: "start", command });
      await waitForExit("p1", 10000);
      const result = await runProcess({ action: "output", process_id: "p1", lines: 500 });

      expect(result.content).not.toContain("line_1\n");
      expect(result.content).toContain("line_500");
      expect(result.content).toContain("line_510");
      expect(result.content).toContain("500/500 lines");
    });
  });

  describe("output truncation", () => {
    it("truncates output exceeding MAX_OUTPUT_CHARS", async () => {
      const command = "python3 -c \"for _ in range(250): print('X'*100)\"";
      await runProcess({ action: "start", command });
      await waitForExit("p1", 10000);
      const result = await runProcess({ action: "output", process_id: "p1", lines: 500 });

      expect(result.content).toContain("truncated");
    });
  });

  describe("output lines clamping", () => {
    it("clamps requested lines to valid range", async () => {
      await runProcess({ action: "start", command: "for i in $(seq 1 5); do echo line_$i; done" });
      await waitForExit("p1");

      const zeroLines = await runProcess({ action: "output", process_id: "p1", lines: 0 });
      const negativeLines = await runProcess({ action: "output", process_id: "p1", lines: -5 });

      expect(zeroLines.is_error).toBeUndefined();
      expect(negativeLines.is_error).toBeUndefined();
    });
  });

  describe("list with long last-line truncation", () => {
    it("truncates last output line at 80 chars in list view", async () => {
      const longLine = "B".repeat(120);
      await runProcess({ action: "start", command: `echo ${longLine} && sleep 30` });

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const output = await runProcess({ action: "output", process_id: "p1" });
        if (output.content && !output.content.includes("(no output)")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const result = await runProcess({ action: "list" });
      const lastMatch = result.content!.match(/last: (.+)/);

      expect(lastMatch).toBeTruthy();
      expect(lastMatch![1]).toContain("...");
      expect(lastMatch![1].length).toBeLessThanOrEqual(80);
    }, 10_000);
  });

  describe("chunk boundary handling", () => {
    it("preserves blank lines in output", async () => {
      await runProcess({ action: "start", command: "printf 'line1\\n\\nline3\\n'" });
      const content = await waitForExit("p1");
      const lines = content.split("\n");
      const outputStart = lines.findIndex((line) => line.includes("line1"));

      expect(outputStart).toBeGreaterThanOrEqual(0);
      expect(content).toContain("line1");
      expect(content).toContain("line3");

      const bufferLines = lines.slice(outputStart);
      const line1Index = bufferLines.indexOf("line1");
      const line3Index = bufferLines.indexOf("line3");
      expect(line3Index).toBeGreaterThan(line1Index + 1);
    });

    it("reassembles lines split across chunks via partial buffering", async () => {
      await runProcess({ action: "start", command: "printf 'partial'; printf '_complete\\n'" });
      const output = await waitForExit("p1");

      expect(output).toContain("partial_complete");
    });

    it("flushes partial stdout line on process exit", async () => {
      await runProcess({ action: "start", command: "printf 'no-newline-at-end'" });
      const output = await waitForExit("p1");

      expect(output).toContain("no-newline-at-end");
    });

    it("flushes partial stderr line on process exit", async () => {
      await runProcess({ action: "start", command: "printf 'stderr-no-nl' >&2" });
      const output = await waitForExit("p1");

      expect(output).toContain("[stderr] stderr-no-nl");
    });
  });

  describe("output with no lines produced", () => {
    it("shows (no output) for process with empty output", async () => {
      await runProcess({ action: "start", command: "sleep 60" });
      const result = await runProcess({ action: "output", process_id: "p1", lines: 50 });

      expect(result.content).toContain("(no output)");
    });
  });

  describe("output during process exit", () => {
    it("returns consistent state when read during exit", async () => {
      await runProcess({ action: "start", command: "echo line1 && sleep 0.1 && echo line2" });

      const results = await Promise.all([
        runProcess({ action: "output", process_id: "p1", lines: 50 }),
        new Promise<void>((resolve) => setTimeout(resolve, 200)).then(() =>
          runProcess({ action: "output", process_id: "p1", lines: 50 }),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 800)).then(() =>
          runProcess({ action: "output", process_id: "p1", lines: 50 }),
        ),
      ]);

      for (const result of results) {
        expect(result.is_error).toBeUndefined();
        expect(result.content).toContain("p1");
      }
      expect(results[2].content).toContain("line1");
      expect(results[2].content).toContain("line2");
    });
  });
});
