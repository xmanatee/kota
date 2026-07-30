import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImproverSemanticCheck } from "./improver-semantic-gate.js";

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
const mockExecFileSync = vi.hoisted(() => vi.fn());

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
    execFileSync: mockExecFileSync,
  };
});

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-gate-errors-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(projectDir: string, runDirPath: string) {
  return {
    projectDir,
    workflow: {
      name: "improver",
      runId: "test-run",
      runDirPath,
      definitionPath: "src/modules/autonomy/workflows/improver/workflow.ts",
    },
    trigger: { event: "workflow.build.committed", payload: {} },
    stepOutputs: {},
    stepResults: {},
    runTool: vi.fn(),
    runAgentHarness: mockRunAgentHarness,
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    triggerWorkflow: vi.fn(),
    readRuntimeState: vi.fn(),
  } as never;
}

function prepareStagedChangeMock(): void {
  mockExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
    const argStr = Array.isArray(args) ? args.join(" ") : "";
    if (argStr.includes("--name-only")) return "file.ts\n";
    if (argStr.includes("--stat")) return " file.ts | 1 +\n";
    return "diff\n";
  });
}

type CodeCheck = {
  run: (ctx: never, parentStep: never) => Promise<unknown>;
};

const TEST_PARENT_STEP = { harness: "claude-agent-sdk" } as never;

describe("createImproverSemanticCheck runtime errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries on transient provider SDK errors", async () => {
    vi.useFakeTimers();
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Some change");
    prepareStagedChangeMock();

    mockRunAgentHarness.mockResolvedValue({
      text: "Claude Code returned an error result: API Error: 500 internal",
      streamedText: "",
      turns: 5,
      isError: true,
      subtype: "error_during_execution",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const assertion = expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Semantic gate failed \(attempt 3\/3\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("returns a warning (not a failure) when the gate exhausts max_turns", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Some change");
    prepareStagedChangeMock();

    mockRunAgentHarness.mockResolvedValue({
      text: "",
      streamedText: "",
      turns: 10,
      isError: true,
      subtype: "error_max_turns",
    });

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(
      makeContext(dir, runDir),
      TEST_PARENT_STEP,
    );
    expect(result).toMatch(/semantic gate unavailable/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });

  it("still rejects on unclassified SDK throws that are not runaway", async () => {
    const dir = makeTmpDir();
    const runDir = join(dir, ".kota/runs/test-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "commit-message.txt"), "Some change");
    prepareStagedChangeMock();

    mockRunAgentHarness.mockRejectedValue(
      new Error("Claude Code returned an error result: something truly unexpected"),
    );

    const check = createImproverSemanticCheck({ runDirPath: runDir });
    await expect(
      (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP),
    ).rejects.toThrow(/Semantic gate threw \(attempt 1\/3\)/);
    expect(mockRunAgentHarness).toHaveBeenCalledTimes(1);
  });
});
