import "./critic-test-fixture.integration.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck, getCriticPromptHash } from "./critic.js";
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

describe("critic verdict handling", () => {
  beforeEach(resetCriticTestMocks);

  it("recovers verdict from response with preamble text before JSON", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-preamble.md", "---\ntitle: Test preamble\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValue({
      text: 'Based on my review:\n\n```json\n{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"Looks good."}\n```',
      streamedText: "",
      turns: 1,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
  });

  it("recovers verdict from response with bare JSON after preamble", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-bare.md", "---\ntitle: Test bare\n---\nContent.");
    const runDir = makeRunDir(dir);
    mockRunAgentHarness.mockResolvedValue({
      text: 'Assessment:\n\n{"verdict":"pass_with_warnings","critical_issues":[],"warnings":["Minor issue"],"summary":"Mostly complete."}',
      streamedText: "",
      turns: 1,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass_with_warnings/);
  });

  it("throws on fail verdict with critical issues", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-bar.md", "---\ntitle: Do bar\n---\nDo bar.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "fail",
      critical_issues: ["Missing unit tests", "Docs not updated"],
      warnings: [],
      summary: "Work is incomplete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/2 critical issue/);
  });

  it("writes critic-review.json on fail", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-bar.md", "---\ntitle: Do bar\n---\nDo bar.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "fail",
      critical_issues: ["Incomplete"],
      warnings: [],
      summary: "Not done.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("passes with warnings and writes critic-review.json", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-baz.md", "---\ntitle: Do baz\n---\nDo baz.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Could improve error messages"],
      summary: "Mostly complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass_with_warnings/);
    expect(result).toMatch(/1 warning/);

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("pass_with_warnings");
    expect(artifact.warnings).toHaveLength(1);
    expect(artifact.reviewerPromptHash).toBe(getCriticPromptHash());
    const scrutiny = JSON.parse(readFileSync(join(runDir, "review-scrutiny.json"), "utf8"));
    expect(scrutiny).toMatchObject({
      surface: "critic",
      workflow: "builder",
      taskId: "task-baz",
      reviewerPromptHash: getCriticPromptHash(),
      decision: "pass_with_warnings",
      thinAcceptance: false,
      signals: { warningCount: 1 },
      absentMetrics: [
        "evidenceIdCount",
        "findingCount",
        "followUpTaskCount",
      ],
    });
  });

  it("writes citation-backed clean passes as non-thin review scrutiny", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-cited.md", "---\ntitle: Do cited\n---\nDo cited.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Done When criteria are covered by src/modules/autonomy/critic.ts:98.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);

    const scrutiny = JSON.parse(readFileSync(join(runDir, "review-scrutiny.json"), "utf8"));
    expect(scrutiny).toMatchObject({
      surface: "critic",
      workflow: "builder",
      taskId: "task-cited",
      reviewerPromptHash: getCriticPromptHash(),
      decision: "pass",
      thinAcceptance: false,
      signals: {
        warningCount: 0,
        citedFileLineCount: 1,
      },
      absentMetrics: [
        "evidenceIdCount",
        "findingCount",
        "followUpTaskCount",
      ],
    });
  });
});
