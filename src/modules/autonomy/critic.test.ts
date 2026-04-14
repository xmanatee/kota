import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";
import { createCriticCheck } from "./critic.js";

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
  const dir = join(tmpdir(), `kota-critic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(projectDir: string, runDirPath?: string) {
  return {
    projectDir,
    workflow: {
      name: "builder",
      runId: "test-run",
      runDirPath: runDirPath ?? join(projectDir, ".kota/runs/test-run"),
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    },
    trigger: { event: "autonomy.queue.available", payload: {} },
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

function setApiResponse(verdict: CriticVerdict) {
  mockExecuteWithAgentSDK.mockResolvedValue({
    text: JSON.stringify(verdict),
    streamedText: "",
    turns: 1,
    isError: false,
  });
}

type CodeCheck = { run: (ctx: never) => Promise<unknown> };

describe("createCriticCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs through the workflow agent runtime instead of requiring a separate SDK key", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-test.md"), "---\ntitle: Test\n---\nContent.");
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks complete.",
    });

    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir));
    expect(result).toMatch(/pass/);
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledOnce();
  });

  it("skips when no task in doing/ and no staged done/ task", async () => {
    const dir = makeTmpDir();
    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir));
    expect(result).toMatch(/skipping critic review/);
  });

  it("finds task in done/ via staged git diff when doing/ is empty", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const doneDir = join(dir, "data/tasks/done");
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, "task-moved.md"), "---\ntitle: Moved task\n---\nTask content.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    // Mock execFileSync to return a rename entry for the done/ query,
    // and empty strings for diff stat/content/name-only queries.
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("data/tasks/done/")) {
        return `R100\tdata/tasks/backlog/task-moved.md\tdata/tasks/done/task-moved.md\n`;
      }
      return "";
    });

    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks good.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass/);
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledOnce();
    // Verify the task content was passed to the API
    const userMessage = mockExecuteWithAgentSDK.mock.calls[0][0];
    expect(userMessage).toContain("Moved task");
  });

  it("calls the critic agent and passes on pass verdict", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-foo.md"), "---\ntitle: Do foo\n---\nDo foo.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Work looks complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass/);
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledOnce();
  });

  it("gives the critic optional run-trace affordances without requiring a fixed evidence file", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-trace.md"), "---\ntitle: Review trace\n---\nReview trace.");
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Trace context is available.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir));

    const userMessage = mockExecuteWithAgentSDK.mock.calls[0][0];
    const options = mockExecuteWithAgentSDK.mock.calls[0][1];
    expect(userMessage).toContain("If completeness is uncertain, inspect run artifacts yourself");
    expect(userMessage).toContain("Do not require a specific evidence artifact");
    expect(userMessage).toContain(`${runDir}/steps/*.events.jsonl`);
    expect(options.allowedTools).toBeUndefined();
    expect(options.effort).toBe("max");
  });

  it("recovers verdict from response with preamble text before JSON", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-preamble.md"), "---\ntitle: Test preamble\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    // Simulate model returning preamble text before JSON block
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: 'Based on my review of the changes:\n\n```json\n{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"Looks good."}\n```',
      streamedText: "",
      turns: 1,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));
    expect(result).toMatch(/pass/);
  });

  it("recovers verdict from response with bare JSON after preamble", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bare.md"), "---\ntitle: Test bare\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    // Simulate model returning preamble then bare JSON (no fences)
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: 'Here is my assessment:\n\n{"verdict":"pass_with_warnings","critical_issues":[],"warnings":["Minor issue"],"summary":"Mostly complete."}',
      streamedText: "",
      turns: 1,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));
    expect(result).toMatch(/pass_with_warnings/);
  });

  it("throws on fail verdict with critical issues", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bar.md"), "---\ntitle: Do bar\n---\nDo bar.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "fail",
      critical_issues: ["Missing unit tests", "Docs not updated"],
      warnings: [],
      summary: "Work is incomplete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir)),
    ).rejects.toThrow(/2 critical issue/);
  });

  it("writes critic-review.json on fail", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bar.md"), "---\ntitle: Do bar\n---\nDo bar.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "fail",
      critical_issues: ["Incomplete"],
      warnings: [],
      summary: "Not done.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir))).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("retries up to 3 times on transient SDK errors before throwing", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-retry.md"), "---\ntitle: Test retry\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 5,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir)),
    ).rejects.toThrow(/Critic agent failed \(attempt 3\/3\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("succeeds on second retry after initial transient failure", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-recover.md"), "---\ntitle: Test recover\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockExecuteWithAgentSDK
      .mockResolvedValueOnce({
        text: "",
        streamedText: "",
        turns: 5,
        isError: true,
        subtype: "error_max_turns",
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
    const promise = (check as CodeCheck).run(makeContext(dir, runDir));
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toMatch(/pass/);
    expect(mockExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("passes with warnings and writes critic-review.json", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-baz.md"), "---\ntitle: Do baz\n---\nDo baz.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Could improve error messages"],
      summary: "Mostly complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir));

    expect(result).toMatch(/pass_with_warnings/);
    expect(result).toMatch(/1 warning/);

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("pass_with_warnings");
    expect(artifact.warnings).toHaveLength(1);
  });
});
