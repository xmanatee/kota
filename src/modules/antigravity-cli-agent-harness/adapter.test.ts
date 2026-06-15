import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
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
    expect(antigravityCliAgentHarness.supportsMultiTurn).toBe(false);
    expect(antigravityCliAgentHarness.askOwnerToolName).toBeNull();
    expect(antigravityCliAgentHarness.emitsAgentMessageStream).toBe(false);
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
  });

  it("reports AGY runtime and explicit non-interactive auth boundary in readiness", () => {
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
        status: "missing",
        command: "agy",
        required: true,
      },
    });
    expect(readiness?.localAuth?.summary).toContain(
      "cannot be verified non-interactively",
    );
    expect(readiness?.localAuth?.detail).toContain(
      ".gemini/antigravity-cli/settings.json",
    );
  });

  it("runs agy print mode and returns text output", async () => {
    mockAgyProcess({ stdout: "all done\n" });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await antigravityCliAgentHarness.run(
      {
        prompt: "please echo",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        systemPrompt: "be brief",
        cwd: "/repo",
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "agy",
      expect.arrayContaining([
        "--print",
        expect.stringContaining("## Task\n\nplease echo"),
        "--model",
        "gemini-3.5-flash",
        "--print-timeout",
        "5m",
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
      turns: 1,
      isError: false,
    });
  });

  it("uses AGY sandbox mode for passive runs", async () => {
    mockAgyProcess({ stdout: "ok" });

    await antigravityCliAgentHarness.run({
      prompt: "inspect",
      model: "gemini-3.5-flash",
      effort: "medium",
      autonomyMode: "passive",
    });

    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--sandbox"]),
    );
  });

  it("returns a structured error when AGY exits non-zero", async () => {
    mockAgyProcess({ code: 1, stderr: "not logged in" });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.5-flash",
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
      model: "gemini-3.5-flash",
      effort: "xhigh",
      abortController,
    });

    abortController.abort();
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toMatchObject({
      text: "Antigravity CLI run aborted.",
      isError: true,
      subtype: "aborted",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns a typed empty-output error when AGY succeeds without text", async () => {
    mockAgyProcess();

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.5-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "Antigravity CLI completed without output.",
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
        model: "gemini-3.5-flash",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.5-flash",
        effort: "xhigh",
        askOwner: { source: "test" },
      }),
    ).rejects.toThrow(/ask_owner/);
  });
});
