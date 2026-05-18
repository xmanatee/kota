import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
} from "./adapter.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function mockGeminiProcess(options: {
  stdoutLines?: string[];
  stderr?: string;
  code?: number;
} = {}): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

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

  return child;
}

function mockManualGeminiProcess(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  spawnMock.mockReturnValue(child);
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("geminiCliAgentHarness", () => {
  it("registers as the native Gemini CLI harness", () => {
    expect(geminiCliAgentHarness.name).toBe(GEMINI_CLI_AGENT_HARNESS_NAME);
    expect(geminiCliAgentHarness.name).toBe("gemini-cli");
    expect(geminiCliAgentHarness.supportsMultiTurn).toBe(true);
    expect(geminiCliAgentHarness.askOwnerToolName).toBeNull();
    expect(geminiCliAgentHarness.emitsAgentMessageStream).toBe(false);
    expect(geminiCliAgentHarness.toolControl).toBe("native");
    expect(geminiCliAgentHarness.unsupportedRunOptions?.map((option) => option.option)).toEqual(
      expect.arrayContaining(["allowedTools", "disallowedTools", "canUseTool"]),
    );
  });

  it("runs gemini headless stream-json and parses successful output", async () => {
    mockGeminiProcess({
      stdoutLines: [
        JSON.stringify({
          type: "init",
          session_id: "session-1",
          model: "gemini-2.5-pro",
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "all done",
        }),
        JSON.stringify({
          type: "result",
          response: "all done",
          stats: {
            models: {
              "gemini-2.5-pro": {
                tokens: { prompt: 18, candidates: 7 },
              },
            },
          },
        }),
      ],
    });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await geminiCliAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-2.5-pro",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "gemini",
      expect.arrayContaining([
        "--prompt",
        expect.stringContaining("## Task\n\nplease echo"),
        "--output-format",
        "stream-json",
        "--model",
        "gemini-2.5-pro",
        "--approval-mode",
        "default",
      ]),
      expect.objectContaining({ cwd: "/repo" }),
    );
    const promptArg = spawnMock.mock.calls[0][1][1] as string;
    expect(promptArg).toContain("## System instructions\n\nbe brief");
    expect(promptArg).toContain("Do not run `git commit`");
    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "session-1",
      turns: 1,
      inputTokens: 18,
      outputTokens: 7,
      isError: false,
    });
  });

  it("maps passive runs to Gemini CLI plan approval mode", async () => {
    mockGeminiProcess({
      stdoutLines: [
        JSON.stringify({
          type: "result",
          response: "ok",
          stats: { models: {} },
        }),
      ],
    });

    await geminiCliAgentHarness.run({
      prompt: "inspect",
      model: "gemini-2.5-pro",
      effort: "medium",
      autonomyMode: "passive",
    });

    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--approval-mode", "plan"]),
    );
  });

  it("returns a structured error when the Gemini CLI exits non-zero", async () => {
    mockGeminiProcess({ code: 1, stderr: "not logged in" });

    const result = await geminiCliAgentHarness.run({
      prompt: "x",
      model: "gemini-2.5-pro",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "not logged in",
      isError: true,
      subtype: "gemini_cli_error",
    });
  });

  it("returns an aborted result when the caller aborts the subprocess", async () => {
    const child = mockManualGeminiProcess();
    const abortController = new AbortController();
    const run = geminiCliAgentHarness.run({
      prompt: "x",
      model: "gemini-2.5-pro",
      effort: "xhigh",
      abortController,
    });

    abortController.abort();
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toMatchObject({
      text: "Gemini CLI run aborted.",
      isError: true,
      subtype: "aborted",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns a typed empty-output error when Gemini CLI succeeds without JSON", async () => {
    mockGeminiProcess();

    const result = await geminiCliAgentHarness.run({
      prompt: "x",
      model: "gemini-2.5-pro",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "Gemini CLI completed without structured output.",
      isError: true,
      subtype: "gemini_cli_empty_output",
    });
  });

  it("terminates stale-auth prompts emitted instead of stream-json events", async () => {
    const child = mockManualGeminiProcess();
    child.kill.mockImplementation(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, "SIGTERM");
      return true;
    });

    const run = geminiCliAgentHarness.run({
      prompt: "x",
      model: "gemini-2.5-pro",
      effort: "xhigh",
    });

    child.stdout.write(
      "Opening authentication page in your browser. Do you want to continue? [Y/n]: \n",
    );

    await expect(run).resolves.toMatchObject({
      text: expect.stringContaining("non-JSON output"),
      isError: true,
      subtype: "gemini_cli_parse_error",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects unsupported KOTA-owned tool-control surfaces loudly", async () => {
    await expect(
      geminiCliAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-pro",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      geminiCliAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-pro",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);

    await expect(
      geminiCliAgentHarness.run({
        prompt: "x",
        model: "gemini-2.5-pro",
        effort: "xhigh",
        askOwner: { source: "test" },
      }),
    ).rejects.toThrow(/ask_owner/);
  });
});
