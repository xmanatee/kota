import "./critic-test-fixture.integration.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  TEST_PARENT_STEP,
  writeDoingTask,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic judge retry handling", () => {
  beforeEach(resetCriticTestMocks);

  it("retries up to 3 times on transient provider errors before throwing", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-retry.md", "---\ntitle: Test retry\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValue({
      text: "Claude Code returned an error result: API Error: 500 internal",
      streamedText: "",
      turns: 5,
      isError: true,
      subtype: "error_during_execution",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Critic agent failed \(attempt 3\/3\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(3);
  });

  it("returns a warning when the critic exhausts max_turns", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-runaway.md", "---\ntitle: Test runaway\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 20,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/critic unavailable/);
    expect(result).toMatch(/evaluator-calibration/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
    expect(existsSync(join(runDir, "critic-review.json"))).toBe(false);
  });

  it("returns a warning when the SDK throws with a runaway max-turns message", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-thrown.md", "---\ntitle: Test thrown\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockRejectedValue(
      new Error("Claude Code returned an error result: Reached maximum number of turns (20)"),
    );

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/critic unavailable/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });

  it("still rejects on unclassified SDK throws that are not runaway", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-unknown.md", "---\ntitle: Test unknown\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockRejectedValue(
      new Error("Claude Code returned an error result: something truly unexpected"),
    );

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Critic agent threw \(attempt 1\/3\)/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });

  it("succeeds on second retry after initial transient provider failure", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-recover.md", "---\ntitle: Test recover\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness
      .mockResolvedValueOnce({
        text: "Claude Code returned an error result: API Error: 503 overloaded",
        streamedText: "",
        turns: 5,
        isError: true,
        subtype: "error_during_execution",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "Looks good.",
        }),
        streamedText: "",
        turns: 1,
        isError: false,
      });

    const check = createCriticCheck({ runDirPath: runDir });
    const promise = (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(2);
  });

  it("retries with a format reminder when a successful response is pure prose", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-prose.md", "---\ntitle: Test prose\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness
      .mockResolvedValueOnce({
        text: "The implementation appears complete and addresses all criteria.",
        streamedText: "",
        turns: 1,
        isError: false,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "Looks complete after reminder.",
        }),
        streamedText: "",
        turns: 1,
        isError: false,
      });

    const check = createCriticCheck({ runDirPath: runDir });
    const promise = (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(2);
    expect(getPromptArg(mockRunAgentHarness.mock.calls[0])).not.toContain("Format reminder");
    expect(getPromptArg(mockRunAgentHarness.mock.calls[1])).toContain("Format reminder");
  });

  it("throws after exhausting retries when every response is unparseable prose", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-prose-fail.md", "---\ntitle: Test prose fail\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValue({
      text: "This change looks good to me, shipping it.",
      streamedText: "",
      turns: 1,
      isError: false,
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/returned unparseable response/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(3);
  });
});
