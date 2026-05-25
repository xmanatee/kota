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
  kill: ReturnType<typeof vi.fn>;
};

function mockCodexProcess(options: {
  stdoutLines?: string[];
  stderr?: string;
  code?: number;
} = {}): { child: MockChild; stdinText: () => string } {
  const child = new EventEmitter() as MockChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  const stdinChunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));

  spawnMock.mockReturnValue(child);

  queueMicrotask(() => {
    for (const line of options.stdoutLines ?? []) {
      child.stdout.write(`${line}\n`);
    }
    child.stdout.end();
    if (options.stderr) child.stderr.write(options.stderr);
    child.stderr.end();
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
  vi.clearAllMocks();
});

describe("codexAgentHarness", () => {
  it("registers as the Codex CLI harness", () => {
    expect(codexAgentHarness.name).toBe(CODEX_AGENT_HARNESS_NAME);
    expect(codexAgentHarness.supportsMultiTurn).toBe(true);
    expect(codexAgentHarness.askOwnerToolName).toBeNull();
    expect(codexAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(codexAgentHarness.toolControl).toBe("native");
    expect(codexAgentHarness.unsupportedRunOptions?.map((option) => option.option)).toEqual(
      expect.arrayContaining(["allowedTools", "disallowedTools", "canUseTool"]),
    );
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
    const result = await codexAgentHarness.run(
      {
        prompt: "please echo",
        model: "gpt-5.5",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
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
