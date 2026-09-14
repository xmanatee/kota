import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import {
  createModelClientMock,
  fixtureRunnerMock,
  messagesStreamMock,
  openaiToolsAgentHarness,
  queueEnd,
  queueToolUse,
  registerFixtureTools,
  streamCallSnapshots,
  tool,
} from "./adapter-shared-runner-test-support.js";

function createScopeRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function registerEchoTool(declaration = tool("echo_tool")): void {
  registerFixtureTools([declaration]);
}

describe("openaiToolsAgentHarness KOTA-owned session resume", () => {
  it("establishes a resumable local session before a quiescent progress checkpoint", async () => {
    const scopeRoot = createScopeRoot("openai-tools-checkpoint-resume-");
    try {
      let checkpointSessionId: string | undefined;
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "begin difficult work",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          persistSession: true,
          onMessage: (message) => {
            checkpointSessionId = message.sessionId;
            throw new Error("continuation checkpoint");
          },
        }),
      ).rejects.toThrow("continuation checkpoint");

      expect(messagesStreamMock).not.toHaveBeenCalled();
      expect(checkpointSessionId).toMatch(/^ots_/);
      expect(checkpointSessionId).not.toMatch(/^msg_/);
      if (checkpointSessionId === undefined) {
        throw new Error("missing KOTA-owned checkpoint session id");
      }

      queueEnd("resumed after checkpoint");
      const resumed = await openaiToolsAgentHarness.run({
        prompt: "continue from the durable checkpoint",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        resumeSessionId: checkpointSessionId,
      });

      expect(resumed).toMatchObject({
        sessionId: checkpointSessionId,
        text: "resumed after checkpoint",
      });
      expect(streamCallSnapshots[0].messages).toEqual([
        { role: "user", content: "begin difficult work" },
        { role: "user", content: "continue from the durable checkpoint" },
      ]);
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("persists a neutral transcript and replays it before the resumed prompt", async () => {
    const scopeRoot = createScopeRoot("openai-tools-resume-");
    try {
      registerEchoTool();
      queueToolUse("call_persist", "echo_tool", { text: "hello" });
      queueEnd("saved");
      fixtureRunnerMock.mockResolvedValue({ content: "echo: hello" });

      const persisted = await openaiToolsAgentHarness.run({
        prompt: "please echo",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        persistSession: true,
      });

      expect(persisted.sessionId).toMatch(/^ots_/);
      expect(persisted.sessionId).not.toBe("msg_end");

      const sessionPath = join(
        scopeRoot,
        ".kota",
        "openai-tools-agent-harness",
        "sessions",
        `${persisted.sessionId}.json`,
      );
      const record = JSON.parse(readFileSync(sessionPath, "utf8")) as {
        context: { model: string; providerName: string; cwd: string };
        lastProviderMessageId: string;
        messages: KotaMessage[];
      };
      expect(record.context).toMatchObject({
        model: "openai/gpt-5.6-luna",
        providerName: "openai",
        cwd: scopeRoot,
      });
      expect(record.lastProviderMessageId).toBe("msg_end");
      expect(JSON.stringify(record.messages)).toContain("echo: hello");

      queueEnd("continued with context");
      const resumed = await openaiToolsAgentHarness.run({
        prompt: "continue",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        resumeSessionId: persisted.sessionId,
      });

      expect(resumed).toMatchObject({
        sessionId: persisted.sessionId,
        text: "continued with context",
        turns: 1,
        usage: {
          tokens: { state: "complete", inputTokens: 1, outputTokens: 1 },
          cost: { state: "unavailable", reason: "provider-does-not-report" },
        },
      });
      const replayedMessages = streamCallSnapshots[2].messages;
      expect(replayedMessages[0]).toEqual({ role: "user", content: "please echo" });
      expect(replayedMessages.at(-1)).toEqual({
        role: "user",
        content: "continue",
      });
      expect(JSON.stringify(replayedMessages)).toContain("echo: hello");
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("checkpoints a completed tool result before exposing continuation progress", async () => {
    const scopeRoot = createScopeRoot("openai-tools-tool-result-checkpoint-");
    try {
      registerEchoTool();
      queueToolUse("call_checkpoint", "echo_tool", { text: "once" });
      fixtureRunnerMock.mockResolvedValue({ content: "echo: once" });
      let checkpointSessionId: string | undefined;

      await expect(
        openaiToolsAgentHarness.run({
          prompt: "run the effect once",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          persistSession: true,
          onMessage: (message) => {
            checkpointSessionId = message.sessionId ?? checkpointSessionId;
            if (message.type === "tool_result") {
              throw new Error("continuation checkpoint after tool result");
            }
          },
        }),
      ).rejects.toThrow("continuation checkpoint after tool result");

      expect(fixtureRunnerMock).toHaveBeenCalledTimes(1);
      if (checkpointSessionId === undefined) {
        throw new Error("missing KOTA-owned checkpoint session id");
      }

      queueEnd("continued without replaying the effect");
      const resumed = await openaiToolsAgentHarness.run({
        prompt: "continue from the completed tool result",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        resumeSessionId: checkpointSessionId,
      });

      expect(resumed.text).toBe("continued without replaying the effect");
      expect(fixtureRunnerMock).toHaveBeenCalledTimes(1);
      expect(streamCallSnapshots[1].messages).toEqual([
        { role: "user", content: "run the effect once" },
        expect.objectContaining({ role: "assistant" }),
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "call_checkpoint",
            content: "echo: once",
            is_error: false,
          }],
        },
        { role: "user", content: "continue from the completed tool result" },
      ]);
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects a missing KOTA-owned session id before dispatching a model call", async () => {
    const scopeRoot = createScopeRoot("openai-tools-missing-resume-");
    try {
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "continue",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: "ots_00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toThrow(/was not found/);
      expect(messagesStreamMock).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects a malformed persisted transcript before dispatching a model call", async () => {
    const scopeRoot = createScopeRoot("openai-tools-malformed-resume-");
    try {
      queueEnd("saved");
      const persisted = await openaiToolsAgentHarness.run({
        prompt: "save",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        persistSession: true,
      });
      const path = join(
        scopeRoot,
        ".kota",
        "openai-tools-agent-harness",
        "sessions",
        `${persisted.sessionId}.json`,
      );
      const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      record.messages = [{ role: "system", content: "untrusted" }];
      writeFileSync(path, JSON.stringify(record));
      messagesStreamMock.mockClear();

      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/saved conversation is corrupt/);
      expect(messagesStreamMock).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects resumes with incompatible model, provider, or token capability metadata", async () => {
    const scopeRoot = createScopeRoot("openai-tools-context-resume-");
    try {
      queueEnd("saved");
      const persisted = await openaiToolsAgentHarness.run({
        prompt: "save",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        persistSession: true,
      });

      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-sol",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/created for model/);

      createModelClientMock.mockImplementationOnce(({ model }) => ({
        client: { messages: { create: vi.fn(), stream: messagesStreamMock } },
        model,
        providerName: "openrouter",
      }));
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/created for provider/);

      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-luna",
          modelOutputTokenLimits: { "openai/gpt-5.6-luna": 7777 },
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/output-token capability changed/);
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects resumes when a previously exposed local tool is missing or changed", async () => {
    const scopeRoot = createScopeRoot("openai-tools-tool-resume-");
    try {
      registerEchoTool();
      queueEnd("saved");
      const persisted = await openaiToolsAgentHarness.run({
        prompt: "save",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: scopeRoot,
        persistSession: true,
      });

      registerFixtureTools([]);
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/references unavailable tool "echo_tool"/);

      registerEchoTool({
        ...tool("echo_tool"),
        description: "Changed echo declaration",
      });
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "resume",
          model: "openai/gpt-5.6-luna",
          effort: "xhigh",
          cwd: scopeRoot,
          resumeSessionId: persisted.sessionId,
        }),
      ).rejects.toThrow(/tool declaration for "echo_tool" changed/);
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
