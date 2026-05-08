import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";
import { createCriticCheck } from "./critic.js";
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
    run: vi.fn(),
  })),
);
const mockCreateWorkflowAgentGuards = vi.hoisted(
  () => vi.fn(() => vi.fn(async () => ({ behavior: "allow" }))),
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
  mockRunAgentHarness.mockResolvedValue({
    text: JSON.stringify(verdict),
    streamedText: "",
    turns: 1,
    isError: false,
  });
}

function getPromptArg(call: unknown[]): string {
  const options = call[1] as { prompt: string };
  return options.prompt;
}

function getOptionsArg(call: unknown[]): Record<string, unknown> {
  return call[1] as Record<string, unknown>;
}

type CodeCheck = {
  run: (ctx: never, parentStep: never) => Promise<unknown>;
};

// Minimal parent step to satisfy the repair-check run signature. The critic
// reads `parentStep.harness` as the default judge harness when the factory
// leaves `harnessName` unset — these tests mock `resolveAgentHarness`, so any
// registered name works.
const TEST_PARENT_STEP = { harness: 'claude-agent-sdk' } as never;

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
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });

  it("skips when no task in doing/ and no staged done/ task", async () => {
    const dir = makeTmpDir();
    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
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
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    // Verify the task content was passed to the API
    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
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
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });

  it("classifies blocking and non-blocking warning kinds in the system prompt", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-classify.md"), "---\ntitle: Classify\n---\nClassify.");
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "ok",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const options = getOptionsArg(mockRunAgentHarness.mock.calls[0]);
    const systemPrompt = options.systemPrompt as string;
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
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-drift.md"), "---\ntitle: Drift\n---\nDrift.");
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "ok",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const options = getOptionsArg(mockRunAgentHarness.mock.calls[0]);
    const systemPrompt = options.systemPrompt as string;

    // Done-When non-fulfillment without trace was being accepted as a
    // warning ("not implemented in this change... not traced to a follow-up
    // task"). The class must be explicit so it stops being a hedged warning.
    expect(systemPrompt).toContain("Done-When item not implemented and not traced");
    expect(systemPrompt).toContain("not traced to a follow-up");

    // Runtime defect masked by missing test coverage was being accepted as
    // a warning ("tests only check X, so this defect passes mechanically").
    // The class must be explicit so the critic fails such runs.
    expect(systemPrompt).toContain("Runtime defect masked by missing test coverage");
    expect(systemPrompt).toContain("passes mechanically");

    // The baseline class must call out the "unrelated entry / if inadvertent"
    // hedging pattern observed in builder-xlclds. The presence of any
    // baseline addition outside scope is itself the regression.
    expect(systemPrompt).toContain("if this is inadvertent regeneration");

    // Weak rendered evidence must cover the "artifact exists but only shows
    // a preflight failure" pattern observed in builder-p0coae.
    expect(systemPrompt).toContain("preflight failure");
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
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    const options = getOptionsArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("If completeness is uncertain, inspect run artifacts yourself");
    expect(userMessage).toContain("Do not require a specific evidence artifact");
    // events.jsonl is intentionally NOT advertised: it is routinely 1–3 MB
    // and burns the critic's 20-turn budget without adding signal.
    // Regression guard — run 2026-04-20T06-22-02-604Z-builder-vxjzg3 ate
    // 47 min across 3 budget-exhausted critic retries on a 1.3 MB events.jsonl.
    expect(userMessage).not.toContain(`${runDir}/steps/*.events.jsonl`);
    expect(userMessage).toContain(`${runDir}/steps/*.json`);
    expect(userMessage).toContain("20-turn budget");
    expect(userMessage).toContain("Do not open `steps/*.events.jsonl`");
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toEqual(AUTONOMY_DISALLOWED_TOOLS);
    expect(options.effort).toBe("xhigh");
    expect(options.canUseTool).toEqual(expect.any(Function));
  });

  it("recovers verdict from response with preamble text before JSON", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-preamble.md"), "---\ntitle: Test preamble\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    // Simulate model returning preamble text before JSON block
    mockRunAgentHarness.mockResolvedValue({
      text: 'Based on my review of the changes:\n\n```json\n{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"Looks good."}\n```',
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
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-bare.md"), "---\ntitle: Test bare\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    // Simulate model returning preamble then bare JSON (no fences)
    mockRunAgentHarness.mockResolvedValue({
      text: 'Here is my assessment:\n\n{"verdict":"pass_with_warnings","critical_issues":[],"warnings":["Minor issue"],"summary":"Mostly complete."}',
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
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
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
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow();

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.critical_issues).toHaveLength(1);
  });

  it("retries up to 3 times on transient provider errors before throwing", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-retry.md"), "---\ntitle: Test retry\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness.mockResolvedValue({
      text: "Claude Code returned an error result: API Error: 500 internal",
      streamedText: "",
      turns: 5,
      isError: true,
      subtype: "error_during_execution",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Critic agent failed \(attempt 3\/3\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("returns a warning (not a failure) when the critic exhausts max_turns", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-runaway.md"),
      "---\ntitle: Test runaway\n---\nContent.",
    );

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 20,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/critic unavailable/);
    expect(result).toMatch(/evaluator-calibration/);
    // Still fails fast at the invokeAgentJudge layer: only one SDK call.
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
    // No critic-review.json written — calibration should surface verdict=absent.
    expect(existsSync(join(runDir, "critic-review.json"))).toBe(false);
  });

  it("returns a warning when the SDK throws with a runaway max-turns message", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-thrown.md"),
      "---\ntitle: Test thrown\n---\nContent.",
    );

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness.mockRejectedValue(
      new Error("Claude Code returned an error result: Reached maximum number of turns (20)"),
    );

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/critic unavailable/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });

  it("still rejects on unclassified SDK throws that are not runaway", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-unknown.md"),
      "---\ntitle: Test unknown\n---\nContent.",
    );

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness.mockRejectedValue(
      new Error("Claude Code returned an error result: something truly unexpected"),
    );

    const check = createCriticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Critic agent threw \(attempt 1\/3\)/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });

  it("succeeds on second retry after initial transient provider failure", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-recover.md"), "---\ntitle: Test recover\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness
      .mockResolvedValueOnce({
        text: "Claude Code returned an error result: API Error: 503 overloaded",
        streamedText: "",
        turns: 5,
        isError: true,
        subtype: "error_during_execution",
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
    const promise = (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries with a format reminder when a successful response is pure prose", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-prose.md"), "---\ntitle: Test prose\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness
      .mockResolvedValueOnce({
        text:
          "The implementation appears complete and addresses all four \"Done When\" criteria:\n\n" +
          "1. ✓ Explorer surfaces state — inspectWatchlist categorizes entries.\n" +
          "2. ✓ Fingerprint + summary fields are populated under the snapshot block.\n",
        streamedText: "",
        turns: 1,
        isError: false,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: "pass",
          critical_issues: [],
          warnings: [],
          summary: "Looks complete after reminder.",
        }),
        streamedText: "",
        turns: 1,
        isError: false,
      });

    const check = createCriticCheck({ runDirPath: runDir });
    const promise = (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(2);
    const firstPrompt = getPromptArg(mockRunAgentHarness.mock.calls[0]) as string;
    const secondPrompt = getPromptArg(mockRunAgentHarness.mock.calls[1]) as string;
    expect(firstPrompt).not.toContain("Format reminder");
    expect(secondPrompt).toContain("Format reminder");
    expect(secondPrompt).toContain("did not contain valid JSON");
    vi.useRealTimers();
  });

  it("throws after exhausting retries when every response is unparseable prose", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-prose-fail.md"), "---\ntitle: Test prose fail\n---\nContent.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    mockRunAgentHarness.mockResolvedValue({
      text: "This change looks good to me, shipping it.",
      streamedText: "",
      turns: 1,
      isError: false,
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/returned unparseable response/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("runs the task probe when declared, writes runtime-probe.json, and threads the result into the critic prompt", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-probed.md"),
      [
        "---",
        "title: Probed task",
        "---",
        "## Problem",
        "",
        "## Runtime Probe",
        "command: echo probe-output-marker",
        "timeoutMs: 5000",
        "",
        "## Done When",
        "- probe passes",
      ].join("\n"),
    );

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Probe passed.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);

    const artifact = JSON.parse(readFileSync(join(runDir, "runtime-probe.json"), "utf8"));
    expect(artifact.verdict).toBe("pass");
    expect(artifact.exitCode).toBe(0);
    expect(artifact.probe.command).toBe("echo probe-output-marker");
    expect(artifact.output).toContain("probe-output-marker");

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]) as string;
    expect(userMessage).toContain("## Runtime Probe Result");
    expect(userMessage).toContain("Verdict: pass");
    expect(userMessage).toContain("Command: echo probe-output-marker");
    expect(userMessage).toContain("Treat a failed probe as a critical issue");
  });

  it("records a fail probe verdict and surfaces the failure in the critic prompt", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-probe-fail.md"),
      [
        "---",
        "title: Failing probe task",
        "---",
        "## Runtime Probe",
        "command: echo nope 1>&2 && exit 7",
        "timeoutMs: 5000",
      ].join("\n"),
    );

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "fail",
      critical_issues: ["Runtime probe failed"],
      warnings: [],
      summary: "Probe fail surfaced as critical.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow(/critical issue/);

    const artifact = JSON.parse(readFileSync(join(runDir, "runtime-probe.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.exitCode).toBe(7);
    expect(artifact.output).toContain("nope");

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]) as string;
    expect(userMessage).toContain("Verdict: fail");
    expect(userMessage).toContain("Exit code: 7");
  });

  it("does not write runtime-probe.json when the task has no probe section", async () => {
    const dir = makeTmpDir();
    const doingDir = join(dir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(join(doingDir, "task-noprobe.md"), "---\ntitle: No probe\n---\nBody.");

    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });

    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "No probe needed.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
    expect(existsSync(join(runDir, "runtime-probe.json"))).toBe(false);

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]) as string;
    expect(userMessage).not.toContain("## Runtime Probe Result");
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
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass_with_warnings/);
    expect(result).toMatch(/1 warning/);

    const artifact = JSON.parse(readFileSync(join(runDir, "critic-review.json"), "utf8"));
    expect(artifact.verdict).toBe("pass_with_warnings");
    expect(artifact.warnings).toHaveLength(1);
  });
});
