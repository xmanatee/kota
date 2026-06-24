import "./critic-test-fixture.integration.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCriticCheck, getCriticPromptHash, handleVerdict } from "./critic.js";
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
import { getImproverSemanticGatePromptHash } from "./improver-semantic-gate.js";

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

  it("records no-citation accepted verdicts as citation-backed scrutiny", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-thin.md", "---\ntitle: Do thin\n---\nDo thin.");
    const runDir = makeRunDir(dir);
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) return "src/modules/autonomy/critic.ts\n";
      if (argStr.includes("--stat")) return " src/modules/autonomy/critic.ts | 1 +\n";
      return [
        "diff --git a/src/modules/autonomy/critic.ts b/src/modules/autonomy/critic.ts",
        "--- a/src/modules/autonomy/critic.ts",
        "+++ b/src/modules/autonomy/critic.ts",
        "@@ -98,6 +98,7 @@ export function createCriticCheck() {",
        "+  return true;",
      ].join("\n");
    });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "All required work is complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass_with_warnings/);

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact).toMatchObject({
      verdict: "pass_with_warnings",
      critical_issues: [],
      summary: "All required work is complete.",
      reviewerPromptHash: getCriticPromptHash(),
    });
    expect(artifact.warnings).toEqual([
      expect.stringContaining("src/modules/autonomy/critic.ts:98"),
    ]);

    const scrutiny = JSON.parse(readFileSync(join(runDir, "review-scrutiny.json"), "utf8"));
    expect(scrutiny).toMatchObject({
      surface: "critic",
      workflow: "builder",
      taskId: "task-thin",
      reviewerPromptHash: getCriticPromptHash(),
      decision: "pass_with_warnings",
      thinAcceptance: false,
      signals: {
        warningCount: 1,
        citedFileLineCount: 1,
      },
    });
  });

  it("records semantic-gate accepted verdicts with fallback citations", () => {
    const dir = makeTmpDir();
    const runDir = makeRunDir(dir);
    const result = handleVerdict(
      {
        verdict: "pass",
        critical_issues: [],
        warnings: [],
        summary: "The improver change is useful.",
      },
      runDir,
      "semantic-gate-review.json",
      {
        runId: "test-run",
        workflow: "improver",
        reviewerPromptHash: getImproverSemanticGatePromptHash(),
        fallbackFileLineCitations: ["src/modules/autonomy/improver-semantic-gate.ts:106"],
      },
    );

    expect(result).toMatch(/pass_with_warnings/);
    const artifact = JSON.parse(readFileSync(join(runDir, "semantic-gate-review.json"), "utf8"));
    expect(artifact.warnings[0]).toContain(
      "src/modules/autonomy/improver-semantic-gate.ts:106",
    );

    const scrutiny = JSON.parse(readFileSync(join(runDir, "review-scrutiny.json"), "utf8"));
    expect(scrutiny).toMatchObject({
      surface: "semantic-gate",
      workflow: "improver",
      reviewerPromptHash: getImproverSemanticGatePromptHash(),
      decision: "pass_with_warnings",
      thinAcceptance: false,
      signals: {
        warningCount: 1,
        citedFileLineCount: 1,
      },
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
