import "./adapter-test-support.js";
import { describe, expect, it, vi } from "vitest";
import { antigravityCliAgentHarness } from "./adapter.js";
import {
  adapterTestMocks,
  mockAgyProcess,
  successfulAgyOutput,
  successfulStructuredAgyOutput,
} from "./adapter-test-support.js";
import { ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV } from "./runtime-home.js";

const { sandboxLaunchMock, spawnMock } = adapterTestMocks();

describe("antigravityCliAgentHarness execution", () => {
  it("runs AGY headlessly and translates its structured event stream", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("all done") });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const onMessage = vi.fn();
    const result = await antigravityCliAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-3.7-flash",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
        agentWriteScope: ["data/tasks/"],
        agentOutputDir: "/repo/.kota/runs/run-1/agent-output",
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
        "gemini-3.7-flash",
        "--effort",
        "high",
        "--mode",
        "accept-edits",
        "--dangerously-skip-permissions",
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
        machineAuthorityOwner: "kota",
        authorityConfigPath: "/operator/.kota/config.json",
        writableRoots: [
          "/repo/data/tasks",
          "/repo/.kota/runs/run-1/agent-output",
        ],
        runtimeWritableRoots: [
          "/repo/.kota/runs/run-1/agent-output",
        ],
        env: expect.any(Object),
        readOnlyHostRoots: [
          expect.stringMatching(/Library\/Keychains\/login\.keychain-db$/),
        ],
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
    expect(commandArgs).not.toContain("--sandbox");
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
      usage: {
        tokens: { state: "complete", inputTokens: 12, outputTokens: 3 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      isError: false,
    });
  });

  it("grants only the declared login keychain as a host auth root", async () => {
    const keychainPath = "/operator/Library/Keychains/login.keychain-db";
    mockAgyProcess({ stdout: successfulAgyOutput("ok") });
    await antigravityCliAgentHarness.run({
      prompt: "inspect untrusted repository content",
      model: "gemini-3.7-flash",
      effort: "xhigh",
      cwd: "/repo",
      env: { [ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]: keychainPath },
    });
    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "agy",
      expect.arrayContaining(["--dangerously-skip-permissions"]),
      expect.objectContaining({ readOnlyHostRoots: [keychainPath] }),
      expect.any(Function),
    );
    expect(spawnMock).toHaveBeenCalled();
  });

  it("uses AGY native structured output and normalizes its result for core validation", async () => {
    const outputSchema = {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } },
    };
    mockAgyProcess({
      stdout: successfulStructuredAgyOutput({ status: "complete" }),
    });

    const result = await antigravityCliAgentHarness.run({
      prompt: "inspect",
      model: "gemini-3.6-flash",
      effort: "xhigh",
      outputSchema,
    });

    const commandArgs = spawnMock.mock.calls[0][1] as string[];
    expect(commandArgs).toContain("--json-schema");
    expect(commandArgs[commandArgs.indexOf("--json-schema") + 1]).toBe(
      JSON.stringify(outputSchema),
    );
    expect(result).toMatchObject({
      text: '```json\n{"status":"complete"}\n```',
      sessionId: "conversation-structured",
      isError: false,
    });
  });

  it("uses the reasoning mode built into exact non-Gemini model ids", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("ok") });

    await antigravityCliAgentHarness.run({
      prompt: "inspect",
      model: "claude-opus-4-6-thinking",
      effort: "xhigh",
    });

    const commandArgs = spawnMock.mock.calls[0][1] as string[];
    expect(commandArgs).toEqual(
      expect.arrayContaining(["--model", "claude-opus-4-6-thinking"]),
    );
    expect(commandArgs).not.toContain("--effort");
  });

  it("resumes the native AGY conversation supplied by core", async () => {
    mockAgyProcess({ stdout: successfulAgyOutput("continued") });

    await antigravityCliAgentHarness.run({
      prompt: "continue the repair",
      model: "claude-opus-4-6-thinking",
      effort: "xhigh",
      resumeSessionId: "conversation-previous",
    });

    const commandArgs = spawnMock.mock.calls[0][1] as string[];
    expect(commandArgs).toEqual(
      expect.arrayContaining(["--conversation", "conversation-previous"]),
    );
    expect(commandArgs).not.toContain("--new-project");
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
      expect.arrayContaining([
        "--dangerously-skip-permissions",
        "--mode",
        "plan",
      ]),
      expect.objectContaining({ writableRoots: [] }),
      expect.any(Function),
    );
  });
});
