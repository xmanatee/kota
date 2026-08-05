import { EventEmitter } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadScenario } from "#modules/harness-parity/scenario.js";
import { codexAgentHarness } from "./adapter.js";

const spawnMock = vi.hoisted(() => vi.fn());
const sandboxLaunchMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

vi.mock("#core/agent-harness/native-cli-sandbox.js", () => ({
  isNativeCliSandboxBootstrapError: (text: string) =>
    text.includes("sandbox-exec: sandbox_apply: Operation not permitted"),
  withNativeCliSandbox: sandboxLaunchMock,
}));

const SHIPPED_SCENARIOS_ROOT = join(
  import.meta.dirname,
  "..",
  "harness-parity",
  "scenarios",
);

function mockCodexScenarioProcess(): { stdinText: () => string } {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  const stdinChunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));

  spawnMock.mockReturnValue(child);
  queueMicrotask(() => {
    child.stdout.write(`${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Scenario solved." },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 50 },
    })}\n`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });

  return { stdinText: () => Buffer.concat(stdinChunks).toString("utf8") };
}

describe("codex agent harness x fix-arithmetic-bug scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    spawnMock.mockReset();
    sandboxLaunchMock.mockReset().mockImplementation(
      async (
        executable: string,
        args: readonly string[],
        options: { env: NodeJS.ProcessEnv },
        run: (process: {
          command: string;
          args: string[];
          env: NodeJS.ProcessEnv;
        }) => Promise<unknown>,
      ) => run({
        command: "authority-sandbox",
        args: [executable, ...args],
        env: options.env,
      }),
    );
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");
    workingDir = mkdtempSync(join(tmpdir(), "kota-codex-scenario-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("passes the parity scenario prompt to Codex CLI in the scenario working tree", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");
    const process = mockCodexScenarioProcess();

    const result = await codexAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gpt-5.6-sol",
      effort: "xhigh",
      cwd: workingDir,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "authority-sandbox",
      expect.arrayContaining([
        "codex",
        "--cd",
        workingDir,
        "--model",
        "gpt-5.6-sol",
      ]),
      expect.objectContaining({ cwd: workingDir }),
    );
    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.objectContaining({ cwd: workingDir, writableRoots: [workingDir] }),
      expect.any(Function),
    );
    expect(process.stdinText()).toContain(loaded.spec.prompt);
    expect(result).toMatchObject({
      text: "Scenario solved.",
      streamedText: "Scenario solved.",
      inputTokens: 100,
      outputTokens: 50,
      isError: false,
    });
  });
});
