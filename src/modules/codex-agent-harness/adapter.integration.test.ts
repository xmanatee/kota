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

function mockCodexProcess(): void {
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
  spawnMock.mockReturnValue(child);
  queueMicrotask(() => {
    child.stdout.write(`${JSON.stringify({
      type: "thread.started",
      thread_id: "cint",
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "ok" },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 1, output_tokens: 1 },
    })}\n`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });
}

import claudeHarnessModule from "../claude-agent-harness/index.js";
import geminiHarnessModule from "../gemini-agent-harness/index.js";
import openaiToolsHarnessModule from "../openai-tools-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import vercelHarnessModule from "../vercel-agent-harness/index.js";
import codexHarnessModule, {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
} from "./index.js";

describe("codex agent harness integration", () => {
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
    expect(vercelHarnessModule.name).toBe("vercel-agent-harness");
    expect(codexHarnessModule.name).toBe("codex-agent-harness");
    expect(hasAgentHarness(CODEX_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining([
        "claude-agent-sdk",
        "thin",
        "openai-tools",
        "gemini",
        "vercel",
        "codex",
      ]),
    );
    expect(resolveAgentHarness(CODEX_AGENT_HARNESS_NAME)).toBe(
      codexAgentHarness,
    );
  });

  it("runs end-to-end through the registry without falling back to a different harness", async () => {
    mockCodexProcess();

    const harness = resolveAgentHarness(CODEX_AGENT_HARNESS_NAME);
    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await harness.run(
      {
        prompt: "say ok",
        model: "gpt-5.5",
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
