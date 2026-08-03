import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
  resolveCodexIsolatedHostAuthEnv,
} from "./adapter.js";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const sandboxLaunchMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock, spawnSync: spawnSyncMock };
});

vi.mock("#core/agent-harness/machine-authority-sandbox.js", () => ({
  isNativeCliSandboxBootstrapError: (text: string) =>
    text.includes("sandbox-exec: sandbox_apply: Operation not permitted"),
  withNativeCliSandbox: sandboxLaunchMock,
}));

type MockChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
};

function mockCodexProcess(options: {
  stdoutLines?: string[];
  stderr?: string;
  code?: number;
  autoClose?: boolean;
} = {}): { child: MockChild; stdinText: () => string } {
  const child = new EventEmitter() as MockChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = vi.fn();

  const stdinChunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));

  spawnMock.mockReturnValue(child);

  if (options.autoClose !== false) queueMicrotask(() => {
    for (const line of options.stdoutLines ?? []) {
      child.stdout.write(`${line}\n`);
    }
    child.stdout.end();
    if (options.stderr) child.stderr.write(options.stderr);
    child.stderr.end();
    child.exitCode = options.code ?? 0;
    child.emit("close", options.code ?? 0, null);
  });

  return {
    child,
    stdinText: () => Buffer.concat(stdinChunks).toString("utf8"),
  };
}

function mockCodexReadinessProbe(options: {
  authOutput: string;
  authStatus?: number;
}): void {
  spawnSyncMock.mockImplementation(
    (command: string, args: readonly string[]) => {
      if (command === "which" && args.join(" ") === "codex") {
        return { status: 0, stdout: "/opt/bin/codex\n", stderr: "" };
      }
      if (command === "/opt/bin/codex" && args.join(" ") === "--version") {
        return { status: 0, stdout: "codex-cli 0.144.1\n", stderr: "" };
      }
      if (command === "/opt/bin/codex" && args.join(" ") === "login status") {
        return {
          status: options.authStatus ?? 0,
          stdout: options.authStatus === undefined ? options.authOutput : "",
          stderr: options.authStatus === undefined ? "" : options.authOutput,
        };
      }
      return {
        status: 1,
        stdout: "",
        stderr: `unexpected command: ${command} ${args.join(" ")}`,
      };
    },
  );
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockReset();
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("codexAgentHarness", () => {
  it("registers as the Codex CLI harness", () => {
    expect(codexAgentHarness.name).toBe(CODEX_AGENT_HARNESS_NAME);
    expect(codexAgentHarness.supportsMultiTurn).toBe(true);
    expect(codexAgentHarness.askOwnerToolName).toBeNull();
    expect(codexAgentHarness.emitsAgentMessageStream).toBe(true);
    expect(codexAgentHarness.toolControl).toBe("native");
    const unsupported = codexAgentHarness.unsupportedRunOptions?.map((option) => option.option);
    expect(unsupported).toEqual(
      expect.arrayContaining(["allowedTools", "disallowedTools", "canUseTool"]),
    );
    expect(unsupported).not.toContain("onMessage");
  });

  it("preserves the Codex login locator when a trusted host replaces HOME", () => {
    const metadata = resolveCodexIsolatedHostAuthEnv({
      HOME: "/operator",
    });

    expect(metadata).toEqual({
      CODEX_HOME: "/operator/.codex",
    });
    expect(
      resolveCodexIsolatedHostAuthEnv({
        HOME: "/operator",
        CODEX_HOME: "/custom/codex-home",
      }),
    ).toEqual({
      CODEX_HOME: "/custom/codex-home",
    });
    expect(resolveCodexIsolatedHostAuthEnv({})).toEqual({
      CODEX_HOME: join(homedir(), ".codex"),
    });
  });

  it("runs codex exec through ChatGPT auth and parses JSONL output", async () => {
    const process = mockCodexProcess({
      stdoutLines: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "all done" },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 18, output_tokens: 7 },
        }),
      ],
    });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const onMessage = vi.fn();
    const result = await codexAgentHarness.run(
      {
        prompt: "please echo",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        env: {
          OPENAI_API_KEY: "must-not-reach-codex",
          KOTA_TEST_ENV: "preserved",
        },
        onMessage,
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "authority-sandbox",
      expect.arrayContaining([
        "codex",
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--strict-config",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "--model",
        "gpt-5.6-sol",
        "--cd",
        "/repo",
      ]),
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      {
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        mode: "workspace-write",
        env: expect.any(Object),
        prepareEnvironment: expect.any(Function),
      },
      expect.any(Function),
    );
    expect(spawnMock.mock.calls[0][1]).not.toContain(
      'preferred_auth_method="chatgpt"',
    );
    const spawnEnv = spawnMock.mock.calls[0][2].env as NodeJS.ProcessEnv;
    expect(spawnEnv.OPENAI_API_KEY).toBeUndefined();
    expect(spawnEnv.KOTA_TEST_ENV).toBe("preserved");
    expect(process.stdinText()).toContain("## System instructions\n\nbe brief");
    expect(process.stdinText()).toContain("## Task\n\nplease echo");
    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(onMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "status",
        category: "codex.thread.started",
        sessionId: "thread-1",
        text: "Codex thread started.",
      },
      {
        type: "status",
        category: "codex.turn.started",
        sessionId: "thread-1",
        text: "Codex turn started.",
      },
      {
        type: "text",
        sessionId: "thread-1",
        text: "all done",
      },
      {
        type: "result",
        sessionId: "thread-1",
        isError: false,
        numTurns: 1,
        inputTokens: 18,
        outputTokens: 7,
      },
    ]);
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "thread-1",
      turns: 1,
      inputTokens: 18,
      outputTokens: 7,
      isError: false,
    });
  });

  it("reports Codex auth expiry warnings in adapter readiness status metadata", () => {
    mockCodexReadinessProbe({
      authOutput:
        "Logged in using ChatGPT as operator@example.com; expiresAt=2026-07-09T00:00:00.000Z",
    });

    const readiness = codexAgentHarness.readiness?.();

    expect(readiness?.localAuth).toMatchObject({
      kind: "harness-managed-login",
      status: "expiring",
      required: true,
      command: "codex login status",
      summary: "Codex ChatGPT login expires soon",
      expiresAt: "2026-07-09T00:00:00.000Z",
      renewalSummary: "run `codex login` before unattended runs",
    });
    expect(readiness?.localAuth?.detail).toContain("[redacted-email]");
    expect(readiness?.localAuth?.detail).not.toContain("operator@example.com");
  });

  it("reports stale Codex auth as adapter readiness status metadata", () => {
    mockCodexReadinessProbe({
      authStatus: 1,
      authOutput: "Authentication expired for operator@example.com",
    });

    const readiness = codexAgentHarness.readiness?.();

    expect(readiness?.localAuth).toMatchObject({
      kind: "harness-managed-login",
      status: "stale",
      required: true,
      command: "codex login status",
      summary: "Codex ChatGPT login expired",
      renewalSummary: "run `codex login` before unattended runs",
    });
    expect(readiness?.localAuth?.detail).toContain("[redacted-email]");
    expect(readiness?.localAuth?.detail).not.toContain("operator@example.com");
  });

  it("maps passive runs to KOTA's read-only native CLI sandbox", async () => {
    mockCodexProcess({
      stdoutLines: [
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "ok" },
        }),
      ],
    });

    await codexAgentHarness.run({
      prompt: "inspect",
      model: "gpt-5.6-sol",
      effort: "medium",
      autonomyMode: "passive",
    });

    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "codex",
      expect.not.arrayContaining(["--sandbox"]),
      expect.objectContaining({ mode: "read-only" }),
      expect.any(Function),
    );
  });

  it("passes max reasoning effort to current Codex models without lowering it", async () => {
    mockCodexProcess({
      stdoutLines: [
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "ok" },
        }),
      ],
    });

    await codexAgentHarness.run({
      prompt: "inspect",
      model: "gpt-5.6-sol",
      effort: "max",
    });

    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['model_reasoning_effort="max"']),
    );
  });

  it("returns a structured error when the Codex CLI exits non-zero", async () => {
    mockCodexProcess({ code: 1, stderr: "not logged in" });

    const result = await codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "not logged in",
      isError: true,
      subtype: "codex_cli_error",
    });
  });

  it("fails immediately when a command reports nested sandbox bootstrap failure", async () => {
    const process = mockCodexProcess({ autoClose: false });
    const terminated = new Promise<void>((resolve) => {
      process.child.kill.mockImplementationOnce(() => {
        resolve();
        return true;
      });
    });

    const run = codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    });
    process.child.stdout.write(`${JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        aggregated_output:
          "sandbox-exec: sandbox_apply: Operation not permitted\n",
        exit_code: 71,
      },
    })}\n`);
    await terminated;

    process.child.stdout.end();
    process.child.stderr.end();
    process.child.emit("close", null, "SIGTERM");

    expect(process.child.kill).toHaveBeenCalledWith("SIGTERM");
    await expect(run).resolves.toMatchObject({
      text: "sandbox-exec: sandbox_apply: Operation not permitted",
      isError: true,
      subtype: "native_cli_sandbox_error",
    });
  });

  it("terminates a Codex CLI process after its terminal error event", async () => {
    const process = mockCodexProcess({ autoClose: false });
    const onMessage = vi.fn();
    const terminated = new Promise<void>((resolve) => {
      process.child.kill.mockImplementationOnce(() => {
        resolve();
        return true;
      });
    });

    const run = codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      onMessage,
    });

    process.child.stdout.write(
      `${JSON.stringify({ type: "error", message: "provider failed" })}\n`,
    );
    await terminated;

    expect(process.child.kill).toHaveBeenCalledWith("SIGTERM");

    process.child.stdout.end();
    process.child.stderr.end();
    process.child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toMatchObject({
      text: "provider failed",
      isError: true,
      subtype: "codex_cli_error",
    });
    expect(onMessage).toHaveBeenCalledWith({
      type: "result",
      isError: true,
      subtype: "codex_cli_error",
      text: "provider failed",
    });
  });

  it("force-kills aborted Codex CLI runs that do not exit after SIGTERM", async () => {
    vi.useFakeTimers();
    const process = mockCodexProcess({ autoClose: false });
    const abortController = new AbortController();

    const run = codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      abortController,
    });
    await vi.runAllTicks();

    abortController.abort(new Error("step timeout"));

    expect(process.child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);

    expect(process.child.kill).toHaveBeenCalledWith("SIGKILL");

    process.child.stdout.end();
    process.child.stderr.end();
    process.child.exitCode = null;
    process.child.emit("close", null, "SIGKILL");

    await expect(run).resolves.toMatchObject({
      isError: true,
      subtype: "aborted",
    });
    vi.useRealTimers();
  });

  it("rejects unsupported KOTA-only surfaces loudly", async () => {
    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        allowedTools: ["Read"],
      }),
    ).rejects.toThrow(/allowedTools/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        disallowedTools: ["Bash"],
      }),
    ).rejects.toThrow(/disallowedTools/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        autonomyMode: "supervised",
      }),
    ).rejects.toThrow(/non-interactively/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.6-sol",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
