import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";
import {
  createImproverSemanticCheck,
  getImproverSemanticGatePromptHash,
} from "./improver-semantic-gate.js";
import { type ImproverSemanticInspectionInput, inspectImproverSemanticReviewInWorker } from "./review-input-operations.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "./shared.js";

const mockRunAgentHarness = vi.hoisted(() => vi.fn());
const mockResolveAgentHarness = vi.hoisted(() =>
  vi.fn(() => ({
    name: "claude-agent-sdk",
    description: "mock",
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: "mcp__kota_owner_questions__ask_owner",
    emitsAgentMessageStream: true,
    toolControl: "kota",
    run: vi.fn(),
  })),
);
const mockCreateWorkflowAgentGuards = vi.hoisted(
  () => vi.fn(() => vi.fn(async () => ({ behavior: "allow" }))),
);
const mockRunBlocking = vi.fn(
  async (_operation: { exportName: string }, input: ImproverSemanticInspectionInput) =>
    inspectImproverSemanticReviewInWorker(input),
);

vi.mock("#core/agent-harness/index.js", async () => {
  const actual = await vi.importActual<typeof import("#core/agent-harness/index.js")>(
    "#core/agent-harness/index.js",
  );
  return {
    ...actual,
    createWorkflowAgentGuards: mockCreateWorkflowAgentGuards,
    resolveAgentHarness: mockResolveAgentHarness,
    runAgentHarness: mockRunAgentHarness,
  };
});

function getPromptArg(call: unknown[]): string {
  const options = call[1] as { prompt: string };
  return options.prompt;
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), ".kota/\n");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", ".gitignore", "seed.txt"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "seed"], { cwd: dir });
  return dir;
}

function commitFile(projectDir: string, path: string, content: string): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  execFileSync("git", ["add", "--", path], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", `seed ${path}`], {
    cwd: projectDir,
  });
}

function stageFile(projectDir: string, path: string, content: string): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  execFileSync("git", ["add", "--", path], { cwd: projectDir });
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
    trigger: { event: "autonomy.issue.decision-requested", payload: {} },
    stepOutputs: {},
    stepResults: {},
    runBlocking: mockRunBlocking,
    runTool: vi.fn(),
    runAgentHarness: mockRunAgentHarness,
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    triggerWorkflow: vi.fn(),
    readRuntimeState: vi.fn(),
  } as never;
}

function setGateResponse(verdict: CriticVerdict) {
  mockRunAgentHarness.mockResolvedValue({
    text: JSON.stringify(verdict),
    streamedText: "",
    turns: 1,
    isError: false,
  });
}

type CodeCheck = {
  run: (ctx: never, parentStep: never) => Promise<unknown>;
};

const TEST_PARENT_STEP = { harness: 'claude-agent-sdk', effort: 'xhigh' } as never;

describe("createImproverSemanticCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when there are no workspace changes", async () => {
    const dir = makeTmpDir();
    const check = createImproverSemanticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
    expect(result).toMatch(/no staged changes/);
    expect(mockRunAgentHarness).not.toHaveBeenCalled();
  });

  it("passes a valid autonomy improvement diff", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Increase critic retry count to reduce transient failures");
    commitFile(dir, "src/modules/autonomy/critic.ts", "const MAX_RETRIES = 2;\n");
    stageFile(dir, "src/modules/autonomy/critic.ts", "const MAX_RETRIES = 3;\n");

    setGateResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Targeted fix to reduce transient failures.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
    expect(mockRunBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ exportName: "inspectImproverSemanticReviewInWorker" }),
      { projectDir: dir, runDirPath: runDir },
    );
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();

    const prompt = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(prompt).toContain("Increase critic retry count");
    expect(prompt).toContain("src/modules/autonomy/critic.ts");
  });

  it("fails an artifact-only commit", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Fix repair loop abort check");
    stageFile(dir, ".claude/worktrees/repair-loop-abort-check", "scratch\n");

    setGateResponse({
      verdict: "fail",
      critical_issues: ["Diff contains only scratch artifacts (.claude/worktrees/) with no substantive autonomy changes"],
      warnings: [],
      summary: "Artifact-only commit with no semantic value.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/critical issue/);
  });

  it("writes semantic-gate-review.json on fail", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Improve prompts");

    stageFile(dir, "some-file.ts", "export const changed = true;\n");

    setGateResponse({
      verdict: "fail",
      critical_issues: ["No-op change"],
      warnings: [],
      summary: "Not useful.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "semantic-gate-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("passes with warnings and records them", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Adjust timeout values");

    stageFile(
      dir,
      "src/modules/autonomy/workflows/builder/workflow.ts",
      "export const timeoutMs = 1_000;\n",
    );

    setGateResponse({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Evidence connection to run data is weak but change is plausible"],
      summary: "Acceptable change with minor concerns.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass_with_warnings/);
    const artifact = JSON.parse(readFileSync(join(runDir, "semantic-gate-review.json"), "utf8"));
    expect(artifact.warnings).toHaveLength(1);
    expect(artifact.reviewerPromptHash).toBe(getImproverSemanticGatePromptHash());
    const scrutiny = JSON.parse(readFileSync(join(runDir, "review-scrutiny.json"), "utf8"));
    expect(scrutiny).toMatchObject({
      surface: "semantic-gate",
      workflow: "improver",
      reviewerPromptHash: getImproverSemanticGatePromptHash(),
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

  it("includes commit message and run artifacts in the prompt", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Unique commit message for test");

    stageFile(dir, "file.ts", "export const changed = true;\n");

    setGateResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "OK.",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const prompt = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(prompt).toContain("Unique commit message for test");
    expect(prompt).toContain("improver workflow run");
    expect(prompt).toContain(`${runDir}/metadata.json`);
    expect(prompt).toContain(`${runDir}/steps/*.events.jsonl`);

    const options = mockRunAgentHarness.mock.calls[0][1] as Record<string, unknown>;
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toEqual(AUTONOMY_DISALLOWED_TOOLS);
    expect(options.effort).toBe("xhigh");
    expect(options.canUseTool).toEqual(expect.any(Function));
  });

});
