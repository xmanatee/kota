import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

function mockGeminiCliProcess(): void {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  spawnMock.mockReturnValue(child);
  queueMicrotask(() => {
    child.stdout.write(`${JSON.stringify({
      type: "init",
      session_id: "gcint",
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "message",
      role: "assistant",
      content: "ok",
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "result",
      response: "ok",
      stats: {
        models: {
          "gemini-2.5-pro": { tokens: { prompt: 1, candidates: 1 } },
        },
      },
    })}\n`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });
}

import claudeHarnessModule from "../claude-agent-harness/index.js";
import codexHarnessModule from "../codex-agent-harness/index.js";
import geminiHarnessModule from "../gemini-agent-harness/index.js";
import openaiToolsHarnessModule from "../openai-tools-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import vercelHarnessModule from "../vercel-agent-harness/index.js";
import geminiCliHarnessModule, {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
} from "./index.js";

describe("gemini-cli agent harness integration", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers alongside the other shipped harnesses under its declared name", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(openaiToolsHarnessModule.name).toBe("openai-tools-agent-harness");
    expect(geminiHarnessModule.name).toBe("gemini-agent-harness");
    expect(codexHarnessModule.name).toBe("codex-agent-harness");
    expect(vercelHarnessModule.name).toBe("vercel-agent-harness");
    expect(geminiCliHarnessModule.name).toBe("gemini-cli-agent-harness");
    expect(hasAgentHarness(GEMINI_CLI_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining([
        "claude-agent-sdk",
        "thin",
        "openai-tools",
        "gemini",
        "codex",
        "vercel",
        "gemini-cli",
      ]),
    );
    expect(resolveAgentHarness(GEMINI_CLI_AGENT_HARNESS_NAME)).toBe(
      geminiCliAgentHarness,
    );
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    mockGeminiCliProcess();

    const harness = resolveAgentHarness(GEMINI_CLI_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "gemini-2.5-pro",
        effort: "xhigh",
      },
      writer,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith("ok");
    expect(result).toMatchObject({
      text: "ok",
      streamedText: "ok",
      isError: false,
    });
  });
});
