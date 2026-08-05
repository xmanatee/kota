import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
  resolveGeminiCliIsolatedHostAuthEnv,
} from "./adapter.js";
import { GEMINI_CLI_AUTH_DIR_ENV } from "./runtime-home.js";

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
  vi.clearAllMocks();
});

describe("geminiCliAgentHarness", () => {
  it("registers as the native Gemini CLI harness", () => {
    expect(geminiCliAgentHarness.name).toBe(GEMINI_CLI_AGENT_HARNESS_NAME);
    expect(geminiCliAgentHarness.name).toBe("gemini-cli");
    expect(geminiCliAgentHarness.supportsMultiTurn).toBe(true);
    expect(geminiCliAgentHarness.askOwnerToolName).toBeNull();
    expect(geminiCliAgentHarness.emitsAgentMessageStream).toBe(true);
    expect(geminiCliAgentHarness.toolControl).toBe("native");
    expect(geminiCliAgentHarness.unsupportedRunOptions?.map((option) => option.option)).toEqual(
      expect.arrayContaining(["allowedTools", "disallowedTools", "canUseTool", "scopePolicy"]),
    );
    expect(geminiCliAgentHarness.unsupportedRunOptions?.map((option) => option.option))
      .not.toContain("onMessage");
  });

  it("projects only the Gemini login locator when a trusted host replaces HOME", () => {
    expect(resolveGeminiCliIsolatedHostAuthEnv({ HOME: "/operator" }))
      .toEqual({
        [GEMINI_CLI_AUTH_DIR_ENV]: "/operator/.gemini",
      });
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
          type: "tool_use",
          tool_name: "read_file",
          tool_id: "tool-1",
          parameters: { path: "README.md" },
        }),
        JSON.stringify({
          type: "tool_result",
          tool_id: "tool-1",
          status: "success",
          output: "# KOTA",
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "all done",
        }),
        JSON.stringify({
          type: "result",
          status: "success",
          response: "all done",
          stats: {
            input_tokens: 18,
            output_tokens: 7,
          },
        }),
      ],
    });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const messages: KotaAgentMessage[] = [];
    const result = await geminiCliAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-2.5-pro",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        onMessage: async (message) => {
          messages.push(message);
        },
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "authority-sandbox",
      expect.arrayContaining([
        "gemini",
        "--skip-trust",
        "--prompt",
        expect.stringContaining("## Task\n\nplease echo"),
        "--output-format",
        "stream-json",
        "--model",
        "gemini-2.5-pro",
        "--approval-mode",
        "default",
      ]),
      expect.objectContaining({ cwd: "/repo", detached: true }),
    );
    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "gemini",
      expect.any(Array),
      {
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        mode: "workspace-write",
        env: expect.any(Object),
        allowedEgressHosts: [
          "accounts.google.com",
          "aiplatform.googleapis.com",
          "cloudcode-pa.googleapis.com",
          "daily-cloudcode-pa.googleapis.com",
          "generativelanguage.googleapis.com",
          "oauth2.googleapis.com",
        ],
        readOnlyHostRoots: expect.any(Array),
        prepareEnvironment: expect.any(Function),
      },
      expect.any(Function),
    );
    const spawnedArgs = spawnMock.mock.calls[0][1] as string[];
    const promptArg = spawnedArgs[spawnedArgs.indexOf("--prompt") + 1]!;
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
    expect(messages).toEqual([
      {
        type: "status",
        category: "gemini.initialized",
        description: "gemini-2.5-pro",
        sessionId: "session-1",
      },
      {
        type: "tool_call",
        toolUseId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
        sessionId: "session-1",
      },
      {
        type: "tool_result",
        toolUseId: "tool-1",
        isError: false,
        content: "# KOTA",
        sessionId: "session-1",
      },
      {
        type: "text",
        text: "all done",
        sessionId: "session-1",
      },
      {
        type: "result",
        text: "all done",
        subtype: "success",
        isError: false,
        numTurns: 1,
        inputTokens: 18,
        outputTokens: 7,
        sessionId: "session-1",
      },
    ]);
  });

  it("preserves warning and unknown stream events without failing the run", async () => {
    mockGeminiProcess({
      stdoutLines: [
        JSON.stringify({
          type: "init",
          session_id: "session-2",
          model: "gemini-2.5-pro",
        }),
        JSON.stringify({
          type: "error",
          severity: "warning",
          message: "Agent execution blocked once",
        }),
        JSON.stringify({ type: "future_event", detail: "preserve me" }),
        JSON.stringify({ type: "message", role: "assistant", content: "recovered" }),
        JSON.stringify({ type: "result", status: "success", stats: {} }),
      ],
    });
    const messages: KotaAgentMessage[] = [];

    const result = await geminiCliAgentHarness.run({
      prompt: "continue",
      model: "gemini-2.5-pro",
      effort: "high",
      onMessage: (message) => {
        messages.push(message);
      },
    });

    expect(result).toMatchObject({ text: "recovered", isError: false });
    expect(messages).toEqual(expect.arrayContaining([
      {
        type: "status",
        category: "gemini.error",
        description: "warning",
        text: "Agent execution blocked once",
        sessionId: "session-2",
      },
      {
        type: "raw",
        adapter: "gemini-cli",
        payload: { type: "future_event", detail: "preserve me" },
        sessionId: "session-2",
      },
    ]));
  });

  it("does not inherit unrelated daemon credentials", async () => {
    mockGeminiProcess({
      stdoutLines: [JSON.stringify({
        type: "result",
        response: "ok",
        stats: { models: {} },
      })],
    });
    const secrets = {
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      GH_TOKEN: "github-secret",
      SLACK_BOT_TOKEN: "notification-secret",
      AWS_SECRET_ACCESS_KEY: "cloud-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "/operator/gcp.json",
    };
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(secrets)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    process.env.GEMINI_API_KEY = "gemini-specific-secret";
    try {
      await geminiCliAgentHarness.run({
        prompt: "inspect",
        model: "gemini-2.5-pro",
        effort: "xhigh",
      });
      const childEnv = sandboxLaunchMock.mock.calls[0][2].env as NodeJS.ProcessEnv;
      for (const key of Object.keys(secrets)) {
        expect(childEnv[key]).toBeUndefined();
      }
      expect(childEnv.GEMINI_API_KEY).toBe("gemini-specific-secret");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (geminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = geminiApiKey;
    }
  });

  it("maps passive runs to plan mode and KOTA's read-only sandbox", async () => {
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

    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "gemini",
      expect.arrayContaining(["--approval-mode", "plan"]),
      expect.objectContaining({ mode: "read-only" }),
      expect.any(Function),
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
    child.emit("close", null, "SIGKILL");

    await expect(run).resolves.toMatchObject({
      text: "Gemini CLI run aborted.",
      isError: true,
      subtype: "aborted",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
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
