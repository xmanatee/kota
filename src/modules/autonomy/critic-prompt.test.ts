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

  it("judges fulfillment, ownership, safety, and proportional proof", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-classify.md", "---\ntitle: Classify\n---\nClassify.");
    const runDir = makeRunDir(dir);
    setApiResponse({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const systemPrompt = getOptionsArg(mockRunAgentHarness.mock.calls[0]).systemPrompt as string;
    expect(systemPrompt).toContain("Fulfillment and observable behavior");
    expect(systemPrompt).toContain("Ownership and maintainability");
    expect(systemPrompt).toContain("Safety and honesty");
    expect(systemPrompt).toContain("Proof sufficiency");
    expect(systemPrompt).toContain("type, schema, generated contract");
    expect(systemPrompt).toContain("accepted as non-actionable");
    expect(systemPrompt).toContain("follow-up task is optional");
  });

  it("classifies an observable defect independently of test presence", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-drift.md", "---\ntitle: Drift\n---\nDrift.");
    const runDir = makeRunDir(dir);
    setApiResponse({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const systemPrompt = getOptionsArg(mockRunAgentHarness.mock.calls[0]).systemPrompt as string;
    expect(systemPrompt).toContain("real runtime defect is critical because the behavior is wrong");
    expect(systemPrompt).toContain("smallest corrective proof");
    expect(systemPrompt).toContain("do not infer it mechanically from task class");
    expect(systemPrompt).not.toContain("production-shaped test");
    expect(systemPrompt).not.toContain("missing test coverage");
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
    const context = makeContext(dir, runDir) as unknown as {
      stepResults: Record<string, unknown>;
    };
    context.stepResults = {
      build: {
        output: {
          content:
            "Validation: generated schema freshness check. Sufficient because the change only updates the generated contract.",
        },
      },
    };
    await (check as CodeCheck).run(context as never, TEST_PARENT_STEP);

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    const options = getOptionsArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("If completeness is uncertain, inspect run artifacts yourself");
    expect(userMessage).toContain("Do not require a specific evidence artifact");
    expect(userMessage).toContain("## Builder completion summary");
    expect(userMessage).toContain("generated schema freshness check");
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
    expect(userMessage).toContain("Available operator evidence refs");
    expect(userMessage).toContain("run:transcript.txt");
  });
});
