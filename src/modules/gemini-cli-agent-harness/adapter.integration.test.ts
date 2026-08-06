import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import {
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import {
  GEMINI_CLI_HOME_ENV,
  GEMINI_FORCE_FILE_STORAGE_ENV,
} from "./runtime-home.js";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() =>
  vi.fn((_cmd: string, args?: string[]) => {
    const argStr = args ? args.join(" ") : "";
    if (argStr.includes("version")) {
      return { status: 0, stdout: "gemini 1.0.0\n", stderr: "" };
    }
    if (argStr.includes("auth") || argStr.includes("login") || argStr.includes("status")) {
      return { status: 0, stdout: "Logged in as test@example.com\n", stderr: "" };
    }
    return { status: 0, stdout: "/usr/local/bin/gemini\n", stderr: "" };
  }),
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock, spawnSync: spawnSyncMock };
});

function mockGeminiCliProcess(): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
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
    return child;
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
    const credentialFreeHome = mkdtempSync(
      join(tmpdir(), "kota-gemini-cli-integration-"),
    );
    const previousGeminiApiKey = process.env.GEMINI_API_KEY;
    const previousGoogleApiKey = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    try {
      const harness = resolveAgentHarness(GEMINI_CLI_AGENT_HARNESS_NAME);
      const writer = { write: vi.fn().mockReturnValue(true) };
      const messages: KotaAgentMessage[] = [];
      const result = await harness.run(
        {
          prompt: "say ok",
          model: "gemini-2.5-pro",
          effort: "xhigh",
          env: { GEMINI_CLI_HOME: credentialFreeHome },
          onMessage: (message) => {
            messages.push(message);
          },
        },
        writer,
      );

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const childEnv = spawnMock.mock.calls[0]?.[2]?.env as
        | NodeJS.ProcessEnv
        | undefined;
      expect(childEnv).toMatchObject({
        [GEMINI_FORCE_FILE_STORAGE_ENV]: "true",
      });
      expect(childEnv?.[GEMINI_CLI_HOME_ENV]).not.toBe(credentialFreeHome);
      expect(childEnv?.[GEMINI_CLI_HOME_ENV]).toMatch(
        /kota-native-cli-.*\/gemini-provider-home$/,
      );
      expect(childEnv?.HOME).toMatch(
        /kota-native-cli-.*\/tool-runtime\/home$/,
      );
      expect(writer.write).toHaveBeenCalledWith("ok");
      expect(result).toMatchObject({
        text: "ok",
        streamedText: "ok",
        isError: false,
      });
      expect(harness.emitsAgentMessageStream).toBe(true);
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "ok" }),
        expect.objectContaining({ type: "result", isError: false }),
      ]));
    } finally {
      if (previousGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousGeminiApiKey;
      if (previousGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = previousGoogleApiKey;
      rmSync(credentialFreeHome, { recursive: true, force: true });
    }
  });
});
