import { describe, expect, it, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessSessionContext,
} from "#core/agent-harness/index.js";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { ProxyTransport } from "#core/loop/transport.js";
import {
  injectSessionEnvironmentVariable,
  sessionEnvironmentForExecution,
} from "#core/tools/session-environment.js";
import { TelegramHarnessSessionAgent } from "./harness-session-agent.js";

const runAgentHarnessMock = vi.hoisted(() => vi.fn());

vi.mock("#core/agent-harness/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/agent-harness/index.js")>();
  return { ...actual, runAgentHarness: runAgentHarnessMock };
});

const harness: AgentHarness = {
  name: "telegram-session-test",
  description: "Telegram session lifecycle test harness",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"],
  askOwnerToolName: null,
  emitsAgentMessageStream: false,
  toolControl: "kota",
  async run() {
    throw new Error("runAgentHarness mock should own execution");
  },
};

describe("TelegramHarnessSessionAgent", () => {
  it("retains one scoped overlay across turns and erases it on close", async () => {
    let identity: AgentHarnessSessionContext | undefined;
    let scopeRoot: string | undefined;
    let cwd: string | undefined;
    runAgentHarnessMock.mockImplementation(async (_harness, options) => {
      identity = options.sessionContext;
      scopeRoot = options.scopeRoot;
      cwd = options.cwd;
      if (identity === undefined) throw new Error("missing Telegram session context");
      injectSessionEnvironmentVariable(
        identity,
        "KOTA_TELEGRAM_SESSION_TEST",
        "session-only",
      );
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      };
    });
    const agent = new TelegramHarnessSessionAgent({
      harness,
      model: "test-model",
      effort: "xhigh",
      scopeRoot: "/tmp/scope-a",
      cwd: "/tmp/scope-a/.worktrees/session-a",
      scopeId: "scope-a",
      config: {},
      autonomyMode: "autonomous",
      proxy: new ProxyTransport(),
    });

    await agent.send("hello");

    expect(identity).toMatchObject({
      sessionId: expect.stringMatching(/^telegram:/),
      scopeId: "scope-a",
    });
    expect({ scopeRoot, cwd }).toEqual({
      scopeRoot: "/tmp/scope-a",
      cwd: "/tmp/scope-a/.worktrees/session-a",
    });
    expect(sessionEnvironmentForExecution(identity)).toEqual({
      KOTA_TELEGRAM_SESSION_TEST: "session-only",
    });
    await agent.close();
    await agent.close();
    expect(sessionEnvironmentForExecution(identity)).toEqual({});
  });
});
