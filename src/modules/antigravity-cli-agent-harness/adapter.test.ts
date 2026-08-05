import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
  antigravityCliAuthReadiness,
} from "./adapter.js";

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

function mockAgyProcess(options: {
  stdout?: string;
  stderr?: string;
  code?: number;
} = {}): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  spawnMock.mockReturnValue(child);

  queueMicrotask(() => {
    if (options.stdout) child.stdout.write(options.stdout);
    child.stdout.end();
    if (options.stderr) child.stderr.write(options.stderr);
    child.stderr.end();
    child.emit("close", options.code ?? 0, null);
  });

  return child;
}

function successfulAgyOutput(text: string): string {
  return [
    { event: "init", conversation_id: "conversation-1" },
    {
      event: "step_update",
      step_update: {
        conversation_id: "conversation-1",
        step_type: "agent_response",
        text_delta: text,
      },
    },
    {
      event: "result",
      result: {
        conversation_id: "conversation-1",
        status: "SUCCESS",
        response: text,
        num_turns: 1,
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function mockManualAgyProcess(): MockChild {
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

describe("antigravityCliAgentHarness", () => {
  it("registers as the native Antigravity CLI readiness harness", () => {
    expect(antigravityCliAgentHarness.name).toBe(
      ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
    );
    expect(antigravityCliAgentHarness.name).toBe("antigravity-cli");
    expect(antigravityCliAgentHarness.supportsMultiTurn).toBe(true);
    expect(antigravityCliAgentHarness.askOwnerToolName).toBeNull();
    expect(antigravityCliAgentHarness.emitsAgentMessageStream).toBe(true);
    expect(antigravityCliAgentHarness.toolControl).toBe("native");
    expect(
      antigravityCliAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).toEqual(
      expect.arrayContaining([
        "allowedTools",
        "disallowedTools",
        "canUseTool",
        "askOwner",
        "mcpServers",
      ]),
    );
    expect(
      antigravityCliAgentHarness.unsupportedRunOptions?.map((option) => option.option),
    ).not.toContain("scopePolicy");
  });

  it("reports AGY runtime and headless model-access readiness", () => {
    const readiness = antigravityCliAgentHarness.readiness?.();

    expect(readiness).toMatchObject({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        command: "agy --version",
        binaryName: "agy",
        required: true,
      },
      localAuth: {
        kind: "harness-managed-login",
        command: "agy models",
        required: true,
      },
    });
  });

  it("accepts a successful AGY model catalog as authenticated readiness", () => {
    const readiness = antigravityCliAuthReadiness({
      resolveBinary: () => ({
        status: "ready",
        executablePath: "/opt/bin/agy",
      }),
      readCommandVersion: () => ({ status: "error", detail: "not used" }),
      readCommandOutput: () => ({
        status: "ready",
        output: "gemini-3.6-flash-high\ngemini-3.1-pro-high",
      }),
      readPackageVersion: () => ({ status: "error", detail: "not used" }),
    });

    expect(readiness).toMatchObject({
      status: "ready",
      command: "agy models",
      summary: "Antigravity CLI login and model access ready",
    });
    expect(readiness.detail).toContain("gemini-3.1-pro-high");
  });

  it("runs AGY headlessly and translates its structured event stream", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("all done") });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const onMessage = vi.fn();
    const result = await antigravityCliAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        onMessage,
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "authority-sandbox",
      expect.arrayContaining([
        "agy",
        "--new-project",
        "--print",
        expect.stringContaining("## Task\n\nplease echo"),
        "--model",
        "gemini-3.6-flash",
        "--effort",
        "high",
        "--mode",
        "accept-edits",
        "--sandbox",
        "--output-format",
        "stream-json",
        "--print-timeout",
        "24h",
      ]),
      expect.objectContaining({ cwd: "/repo", detached: true }),
    );
    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "agy",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/repo",
        authorityConfigPath: "/operator/.kota/config.json",
        writableRoots: ["/repo"],
        env: expect.any(Object),
        readOnlyHostRoots: [expect.stringContaining("Library/Keychains")],
        allowedEgressHosts: [
          "accounts.google.com",
          "aiplatform.googleapis.com",
          "businessaicode.googleapis.com",
          "cloudcode-pa.googleapis.com",
          "daily-cloudcode-pa.googleapis.com",
          "generativelanguage.googleapis.com",
          "lh3.googleusercontent.com",
          "oauth2.googleapis.com",
          "www.googleapis.com",
        ],
        prepareEnvironment: expect.any(Function),
      }),
      expect.any(Function),
    );
    const commandArgs = spawnMock.mock.calls[0][1] as string[];
    const promptArg = commandArgs[commandArgs.indexOf("--print") + 1]!;
    expect(promptArg).toContain("## System instructions\n\nbe brief");
    expect(promptArg).toContain("Do not run `git commit`");
    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(onMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "status",
      "text",
      "result",
    ]);
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "conversation-1",
      turns: 1,
      inputTokens: 12,
      outputTokens: 3,
      isError: false,
    });
  });

  it("does not inherit daemon provider, GitHub, notification, or cloud credentials", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("ok") });
    const secrets = {
      OPENAI_API_KEY: "openai-secret",
      GEMINI_API_KEY: "gemini-secret",
      GH_TOKEN: "github-secret",
      SLACK_BOT_TOKEN: "notification-secret",
      AWS_SECRET_ACCESS_KEY: "cloud-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "/operator/gcp.json",
    };
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(secrets)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      await antigravityCliAgentHarness.run({
        prompt: "inspect",
        model: "gemini-3.6-flash",
        effort: "xhigh",
      });
      const childEnv = sandboxLaunchMock.mock.calls[0][2].env as NodeJS.ProcessEnv;
      for (const key of Object.keys(secrets)) {
        expect(childEnv[key]).toBeUndefined();
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("maps passive runs to KOTA's read-only sandbox", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("ok") });

    await antigravityCliAgentHarness.run({
      prompt: "inspect",
      model: "gemini-3.6-flash",
      effort: "medium",
      autonomyMode: "passive",
    });

    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "agy",
      expect.arrayContaining(["--sandbox", "--mode", "plan"]),
      expect.objectContaining({ writableRoots: [] }),
      expect.any(Function),
    );
  });

  it("returns a structured error when AGY exits non-zero", async () => {
    mockAgyProcess({ code: 1, stderr: "not logged in" });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "not logged in",
      isError: true,
      subtype: "antigravity_cli_error",
    });
  });

  it("returns an aborted result when the caller aborts the subprocess", async () => {
    const child = mockManualAgyProcess();
    const abortController = new AbortController();
    const run = antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
      abortController,
    });

    abortController.abort();
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGKILL");

    await expect(run).resolves.toMatchObject({
      text: "Antigravity CLI run aborted.",
      isError: true,
      subtype: "aborted",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("returns a typed empty-output error when AGY succeeds without text", async () => {
    mockAgyProcess();

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "Antigravity CLI completed without structured output.",
      isError: true,
      subtype: "antigravity_cli_empty_output",
    });
  });

  it("requires an explicit model before invoking AGY", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/requires an explicit model/);
  });

  it("rejects unsupported KOTA-owned tool-control surfaces loudly", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        askOwner: { source: "test" },
      }),
    ).rejects.toThrow(/ask_owner/);
  });
});
