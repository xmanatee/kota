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
  writeOpenTask,
} from "./critic-test-fixture.integration.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic prompt context", () => {
  beforeEach(resetCriticTestMocks);

  it("gives the critic optional run-trace affordances without requiring a fixed evidence file", async () => {
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-trace.md", "---\nstatus: open\npriority: p2\n---\n\n# Review trace\n\nReview trace.");
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
    expect(userMessage).toContain("generated schema freshness check");
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toEqual(AUTONOMY_DISALLOWED_TOOLS);
    expect(options.effort).toBe("xhigh");
    expect(options.canUseTool).toEqual(expect.any(Function));
  });

  it("passes Product tasks with a rendered transcript artifact through to the critic", async () => {
    const dir = makeTmpDir();
    writeOpenTask(
      dir,
      "task-product-transcript.md",
      [
        "---",
        "status: open",
        "priority: p1",
        "---",
        "",
        "# Ship product surface",
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

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("run:transcript.txt");
  });
});
