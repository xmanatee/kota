import "./critic-test-fixture.integration.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  getOptionsArg,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeDoingTask,
} from "./critic-test-fixture.integration.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic prompt context", () => {
  beforeEach(resetCriticTestMocks);

  it("classifies blocking and non-blocking warning kinds in the system prompt", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-classify.md", "---\ntitle: Classify\n---\nClassify.");
    const runDir = makeRunDir(dir);
    setApiResponse({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const systemPrompt = getOptionsArg(mockRunAgentHarness.mock.calls[0]).systemPrompt as string;
    expect(systemPrompt).toContain("Critical-issue vs warning classification");
    expect(systemPrompt).toContain("Weak rendered evidence");
    expect(systemPrompt).toContain("Placeholder or no-value tests");
    expect(systemPrompt).toContain("Untracked compatibility shims");
    expect(systemPrompt).toContain("Baseline-only strictness ratchets");
    expect(systemPrompt).toContain("durable trace");
    expect(systemPrompt).toContain("name the trace");
  });

  it("names the calibration-drift critical classes the live monitor flagged", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-drift.md", "---\ntitle: Drift\n---\nDrift.");
    const runDir = makeRunDir(dir);
    setApiResponse({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const systemPrompt = getOptionsArg(mockRunAgentHarness.mock.calls[0]).systemPrompt as string;
    expect(systemPrompt).toContain("Done-When item not implemented and not traced");
    expect(systemPrompt).toContain("not traced to a follow-up");
    expect(systemPrompt).toContain("Runtime defect masked by missing test coverage");
    expect(systemPrompt).toContain("passes mechanically");
    expect(systemPrompt).toContain("if this is inadvertent regeneration");
    expect(systemPrompt).toContain("preflight failure");
  });

  it("gives the critic optional run-trace affordances without requiring a fixed evidence file", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-trace.md", "---\ntitle: Review trace\n---\nReview trace.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Trace context is available.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    const options = getOptionsArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("If completeness is uncertain, inspect run artifacts yourself");
    expect(userMessage).toContain("Do not require a specific evidence artifact");
    expect(userMessage).not.toContain(`${runDir}/steps/*.events.jsonl`);
    expect(userMessage).toContain(`${runDir}/steps/*.json`);
    expect(userMessage).toContain("20-turn budget");
    expect(userMessage).toContain("Do not open `steps/*.events.jsonl`");
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toEqual(AUTONOMY_DISALLOWED_TOOLS);
    expect(options.effort).toBe("xhigh");
    expect(options.canUseTool).toEqual(expect.any(Function));
  });

  it("passes Product tasks with a rendered transcript artifact through to the critic", async () => {
    const dir = makeTmpDir();
    writeDoingTask(
      dir,
      "task-product-transcript.md",
      [
        "---",
        "id: task-product-transcript",
        "title: Ship product surface",
        "status: doing",
        "priority: p1",
        "area: client",
        "summary: Improve the operator path.",
        "task_class: Product",
        "---",
        "",
        "## Done When",
        "",
        "- Transcript shows the operator path.",
      ].join("\n"),
    );
    const runDir = makeRunDir(dir);
    writeFileSync(join(runDir, "transcript.txt"), "kota report\nProduct: 1\n");
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Transcript proves the journey.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("Product operator evidence refs detected");
    expect(userMessage).toContain("run:transcript.txt");
  });
});
