import "./critic-test-fixture.integration.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeOpenTask,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic operator evidence context", () => {
  beforeEach(resetCriticTestMocks);

  it("lets the critic judge whether a Product task needs operator evidence", async () => {
    const dir = makeTmpDir();
    writeOpenTask(
      dir,
      "task-product-no-evidence.md",
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
        "- Tests pass.",
      ].join("\n"),
    );
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary:
        "The task only changed internal behavior, so an operator artifact is not relevant.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).resolves.toMatch(/pass/);

    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    const prompt = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(prompt).toContain("Available operator evidence refs: none found");
    expect(prompt).toContain("do not infer that from metadata or keywords");
  });

  it("shows only durable operator artifacts to the critic", async () => {
    const dir = makeTmpDir();
    writeOpenTask(
      dir,
      "task-product-screened-evidence.md",
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
    const canonicalRunDir = makeRunDir(dir);
    const agentRunDir = join(dir, ".kota", "builder-evidence", "test-run");
    const durableEvidenceDir = join(canonicalRunDir, "evidence");
    mkdirSync(join(agentRunDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(agentRunDir, "artifacts", "transcript.txt"),
      "kota report\nProduct: 1\n",
    );
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Screened transcript proves the journey.",
    });

    const check = createCriticCheck();
    const context = makeContext(
      dir,
      canonicalRunDir,
      dir,
      agentRunDir,
    );
    await expect(
      (check as CodeCheck).run(context, TEST_PARENT_STEP),
    ).resolves.toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    expect(getPromptArg(mockRunAgentHarness.mock.calls[0])).toContain(
      "Available operator evidence refs: none found",
    );

    mkdirSync(join(durableEvidenceDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(durableEvidenceDir, "artifacts", "transcript.txt"),
      "kota report\nProduct: 1\n",
    );

    await expect(
      (check as CodeCheck).run(context, TEST_PARENT_STEP),
    ).resolves.toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(2);
    expect(getPromptArg(mockRunAgentHarness.mock.calls[1])).toContain(
      "run:artifacts/transcript.txt",
    );
  });
});
