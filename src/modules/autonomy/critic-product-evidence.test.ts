import "./critic-test-fixture.integration.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeDoingTask,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic product evidence gate", () => {
  beforeEach(resetCriticTestMocks);

  it("rejects a Product task with passing checks but no operator journey evidence", async () => {
    const dir = makeTmpDir();
    writeDoingTask(
      dir,
      "task-product-no-evidence.md",
      [
        "---",
        "id: task-product-no-evidence",
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
        "- Tests pass.",
      ].join("\n"),
    );
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Mock judge would pass, but should not be reached.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/operator journey evidence/);

    expect(mockRunAgentHarness).not.toHaveBeenCalled();
    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.summary).toContain("operator journey evidence is absent");
  });
});
