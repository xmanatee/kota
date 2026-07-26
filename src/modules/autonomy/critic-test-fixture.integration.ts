import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mock, vi } from "vitest";
import type { CriticVerdict } from "./critic.js";

type RunAgentHarnessMock = Mock<(...args: unknown[]) => unknown>;

const mockRunAgentHarness = vi.hoisted<RunAgentHarnessMock>(() => vi.fn());
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

vi.mock("./task-probe-sandbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-probe-sandbox.js")>()),
  resolveTaskProbeSandbox: vi.fn(() => ({
    status: "available",
    kind: "linux-bubblewrap",
    processBoundary: "pid-namespace",
    command: "/usr/bin/env",
    prefixArgs: [],
    probeExecutable: "pnpm",
    evidence: "test process boundary",
  })),
}));

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
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFileSync: vi.fn(() => ""),
  };
});

export function resetCriticTestMocks(): void {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(execFileSync).mockReturnValue("");
}

export function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-critic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function makeRunDir(projectDir: string): string {
  const runDir = join(projectDir, ".kota/runs/test-run");
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function writeDoingTask(dir: string, filename: string, content: string): void {
  const doingDir = join(dir, "data/tasks/doing");
  mkdirSync(doingDir, { recursive: true });
  writeFileSync(join(doingDir, filename), content);
}

export function runGit(dir: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

export function commitReadyTask(dir: string, filename: string, content: string): void {
  const readyDir = join(dir, "data/tasks/ready");
  mkdirSync(readyDir, { recursive: true });
  writeFileSync(join(readyDir, filename), content);
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test User"]);
  runGit(dir, ["add", "data/tasks/ready"]);
  runGit(dir, ["commit", "-m", "seed ready task"]);
}

export function moveReadyTaskToDoing(dir: string, filename: string): void {
  const doingDir = join(dir, "data/tasks/doing");
  mkdirSync(doingDir, { recursive: true });
  renameSync(
    join(dir, "data/tasks/ready", filename),
    join(doingDir, filename),
  );
}

export function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "critic-probe-fixture", version: "0.0.0", scripts }, null, 2),
  );
}

export function makeContext(
  projectDir: string,
  runDirPath?: string,
  workspaceDir?: string,
  agentRunDir?: string,
) {
  return {
    projectDir,
    ...(workspaceDir !== undefined ? { workspaceDir } : {}),
    ...(agentRunDir !== undefined
      ? {
          runtimeResources: {
            profileId: "critic-test",
            env: {},
            agentRunDir,
          },
        }
      : {}),
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

export function setApiResponse(verdict: CriticVerdict): void {
  mockRunAgentHarness.mockResolvedValue({
    text: JSON.stringify(verdict),
    streamedText: "",
    turns: 1,
    isError: false,
  });
}

export function getMockRunAgentHarness(): RunAgentHarnessMock {
  return mockRunAgentHarness;
}

export function getPromptArg(call: unknown[]): string {
  const options = call[1] as { prompt: string };
  return options.prompt;
}

export function getOptionsArg(call: unknown[]): Record<string, unknown> {
  return call[1] as Record<string, unknown>;
}

export type CodeCheck = {
  run: (ctx: never, parentStep: never) => Promise<unknown>;
};

// Minimal parent step to satisfy the repair-check run signature.
export const TEST_PARENT_STEP = { harness: "claude-agent-sdk" } as never;
