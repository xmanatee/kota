import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
} from "./adapter.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

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

beforeEach(() => {
  spawnMock.mockReset();
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
        model: "gpt-5.5",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
        onMessage,
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec",
        "--json",
        "--ignore-user-config",
        "--model",
        "gpt-5.5",
        "--cd",
        "/repo",
        "--sandbox",
        "workspace-write",
        "-c",
        'preferred_auth_method="chatgpt"',
      ]),
      expect.objectContaining({ cwd: "/repo" }),
    );
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

  it("maps passive runs to Codex CLI read-only sandbox", async () => {
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
      model: "gpt-5.5",
      effort: "medium",
      autonomyMode: "passive",
    });

    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--sandbox", "read-only"]),
    );
  });

  it("returns a structured error when the Codex CLI exits non-zero", async () => {
    mockCodexProcess({ code: 1, stderr: "not logged in" });

    const result = await codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.5",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "not logged in",
      isError: true,
      subtype: "codex_cli_error",
    });
  });

  it("force-kills aborted Codex CLI runs that do not exit after SIGTERM", async () => {
    vi.useFakeTimers();
    const process = mockCodexProcess({ autoClose: false });
    const abortController = new AbortController();

    const run = codexAgentHarness.run({
      prompt: "x",
      model: "gpt-5.5",
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
        model: "gpt-5.5",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        allowedTools: ["Read"],
      }),
    ).rejects.toThrow(/allowedTools/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        disallowedTools: ["Bash"],
      }),
    ).rejects.toThrow(/disallowedTools/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        autonomyMode: "supervised",
      }),
    ).rejects.toThrow(/non-interactively/);

    await expect(
      codexAgentHarness.run({
        prompt: "x",
        model: "gpt-5.5",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
