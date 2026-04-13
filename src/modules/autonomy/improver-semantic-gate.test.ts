import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";
import { createImproverSemanticCheck } from "./improver-semantic-gate.js";

const mockExecuteWithAgentSDK = vi.hoisted(() => vi.fn());

vi.mock("#core/agent-sdk/index.js", () => {
  return { executeWithAgentSDK: mockExecuteWithAgentSDK };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
  };
});

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(projectDir: string, runDirPath?: string) {
  return {
    projectDir,
    workflow: {
      name: "improver",
      runId: "test-run",
      runDirPath: runDirPath ?? join(projectDir, ".kota/runs/test-run"),
      definitionPath: "src/modules/autonomy/workflows/improver/workflow.ts",
    },
    trigger: { event: "workflow.build.committed", payload: {} },
    stepOutputs: {},
    stepResults: {},
    runTool: vi.fn(),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    triggerWorkflow: vi.fn(),
    readRuntimeState: vi.fn(),
  } as never;
}

function setGateResponse(verdict: CriticVerdict) {
  mockExecuteWithAgentSDK.mockResolvedValue({
    text: JSON.stringify(verdict),
    streamedText: "",
    turns: 1,
    isError: false,
  });
}

type CodeCheck = { run: (ctx: never) => Promise<unknown> };

describe("createImproverSemanticCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when there are no staged changes", async () => {
    const dir = makeTmpDir();
    const check = createImproverSemanticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir));
    expect(result).toMatch(/no staged changes/);
    expect(mockExecuteWithAgentSDK).not.toHaveBeenCalled();
  });

  it("passes a valid autonomy improvement diff", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Increase critic retry count to reduce transient failures");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) {
        return "src/modules/autonomy/critic.ts\n";
      }
      if (argStr.includes("--stat")) {
        return " src/modules/autonomy/critic.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n";
      }
      return "diff --git a/src/modules/autonomy/critic.ts b/src/modules/autonomy/critic.ts\n--- a/src/modules/autonomy/critic.ts\n+++ b/src/modules/autonomy/critic.ts\n@@ -1,1 +1,1 @@\n-const MAX_RETRIES = 2;\n+const MAX_RETRIES = 3;\n";
    });

    setGateResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Targeted fix to reduce transient failures.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));
    expect(result).toMatch(/pass/);
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledOnce();

    const prompt = mockExecuteWithAgentSDK.mock.calls[0][0];
    expect(prompt).toContain("Increase critic retry count");
    expect(prompt).toContain("src/modules/autonomy/critic.ts");
  });

  it("fails an artifact-only commit", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Fix repair loop abort check");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) {
        return ".claude/worktrees/repair-loop-abort-check\n";
      }
      if (argStr.includes("--stat")) {
        return " .claude/worktrees/repair-loop-abort-check | 1 +\n 1 file changed, 1 insertion(+)\n";
      }
      return "diff --git a/.claude/worktrees/repair-loop-abort-check b/.claude/worktrees/repair-loop-abort-check\nnew file mode 100644\n";
    });

    setGateResponse({
      verdict: "fail",
      critical_issues: ["Diff contains only scratch artifacts (.claude/worktrees/) with no substantive autonomy changes"],
      warnings: [],
      summary: "Artifact-only commit with no semantic value.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir)),
    ).rejects.toThrow(/critical issue/);
  });

  it("writes semantic-gate-review.json on fail", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Improve prompts");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) return "some-file.ts\n";
      if (argStr.includes("--stat")) return " some-file.ts | 1 +\n";
      return "diff\n";
    });

    setGateResponse({
      verdict: "fail",
      critical_issues: ["No-op change"],
      warnings: [],
      summary: "Not useful.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir))).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "semantic-gate-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("passes with warnings and records them", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Adjust timeout values");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) return "src/modules/autonomy/workflows/builder/workflow.ts\n";
      if (argStr.includes("--stat")) return " src/modules/autonomy/workflows/builder/workflow.ts | 2 +-\n";
      return "diff content\n";
    });

    setGateResponse({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Evidence connection to run data is weak but change is plausible"],
      summary: "Acceptable change with minor concerns.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass_with_warnings/);
    const artifact = JSON.parse(readFileSync(join(runDir, "semantic-gate-review.json"), "utf8"));
    expect(artifact.warnings).toHaveLength(1);
  });

  it("includes commit message and run artifacts in the prompt", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Unique commit message for test");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) return "file.ts\n";
      if (argStr.includes("--stat")) return " file.ts | 1 +\n";
      return "diff\n";
    });

    setGateResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "OK.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir));

    const prompt = mockExecuteWithAgentSDK.mock.calls[0][0];
    expect(prompt).toContain("Unique commit message for test");
    expect(prompt).toContain("improver workflow run");
    expect(prompt).toContain(`${runDir}/metadata.json`);
    expect(prompt).toContain(`${runDir}/steps/*.events.jsonl`);

    const options = mockExecuteWithAgentSDK.mock.calls[0][1];
    expect(options.allowedTools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("retries on transient SDK errors", async () => {
    vi.useFakeTimers();
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Some change");

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("--name-only")) return "file.ts\n";
      if (argStr.includes("--stat")) return " file.ts | 1 +\n";
      return "diff\n";
    });

    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 5,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir)),
    ).rejects.toThrow(/Semantic gate failed \(attempt 3\/3\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
