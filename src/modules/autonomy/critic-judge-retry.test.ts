import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBackoffAdmissionError } from "#core/workflow/agent-backoff.js";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  TEST_PARENT_STEP,
  writeOpenTask,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic judge retry handling", () => {
  beforeEach(resetCriticTestMocks);

  it("clears a prior failed verdict when the final critic attempt is unavailable", async () => {
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-stale-fail.md", "---\nstatus: open\npriority: p2\n---\n\n# Test stale fail\n\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "fail",
        critical_issues: ["The first draft is incomplete."],
        warnings: [],
        summary: "Repair is required.",
      }),
      streamedText: "",
      turns: 1,
      isError: false,
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/critical issue/);
    expect(existsSync(join(runDir, "critic-review.json"))).toBe(true);
    expect(existsSync(join(runDir, "review-scrutiny.json"))).toBe(true);

    mockRunAgentHarness.mockResolvedValueOnce({
      text: "",
      streamedText: "",
      turns: 20,
      isError: true,
      subtype: "error_max_turns",
    });
    const result = await (check as CodeCheck).run(
      makeContext(dir, runDir),
      TEST_PARENT_STEP,
    );

    expect(result).toMatch(/critic unavailable/);
    expect(result).toMatch(/verdict=absent/);
    expect(existsSync(join(runDir, "critic-review.json"))).toBe(false);
    expect(existsSync(join(runDir, "review-scrutiny.json"))).toBe(false);
  });

  it("does not retry after the shared agent backoff gate rejects dispatch", async () => {
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-parked.md", "---\nstatus: open\npriority: p2\n---\n\n# Test parked provider\n\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockRejectedValue(
      new AgentBackoffAdmissionError({
        runtimeId: "agy:antigravity-cli",
        kind: "provider",
        failureCount: 1,
        until: "2026-09-02T18:00:00.000Z",
        updatedAt: "2026-09-02T17:55:00.000Z",
        reason: "provider unavailable",
      }),
    );

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toBeInstanceOf(AgentBackoffAdmissionError);

  });

  it("succeeds on second retry after initial transient provider failure", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-recover.md", "---\nstatus: open\npriority: p2\n---\n\n# Test recover\n\nContent.");
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
    const promise = (check as CodeCheck).run(
      makeContext(dir, runDir, undefined, undefined, {}, ""),
      TEST_PARENT_STEP,
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toMatch(/pass/);

  });


});
