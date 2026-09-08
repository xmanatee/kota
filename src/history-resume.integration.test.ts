/** Real session initialization, history provider persistence and resumed model context. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "./core/loop/loop.js";
import { BufferTransport } from "./core/loop/transport.js";
import { createMockClient, textResponse } from "./core/model/mock-client.test-support.js";
import { getScopeHistoryStore } from "./modules/history/history.js";

describe("session history persistence", () => {
  let scopeRoot: string;
  beforeEach(() => { scopeRoot = mkdtempSync(join(tmpdir(), "kota-history-resume-")); });
  afterEach(() => { rmSync(scopeRoot, { recursive: true, force: true }); });

  function session(response: string, options: { resumeConversation?: string; noHistory?: boolean } = {}) {
    const [client, calls] = createMockClient([textResponse(response)]);
    return { calls, agent: new AgentSession({ scopeRoot, client, transport: new BufferTransport(), model: "claude-haiku-4-5-20251001", autonomyMode: "autonomous", reflectionEnabled: false, ...options }) };
  }

  it("restores saved context in a new session and appends to the same durable conversation", async () => {
    const first = session("I can help!");
    await first.agent.send("Help me");
    const conversationId = first.agent.getConversationId();
    await first.agent.dispose();
    expect(conversationId).toBeTruthy();

    const resumed = session("Continuing!", { resumeConversation: conversationId! });
    await resumed.agent.send("Continue the task");
    await resumed.agent.dispose();
    expect(resumed.calls[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Help me" }),
      expect.objectContaining({ role: "user", content: "Continue the task" }),
    ]));
    const history = getScopeHistoryStore(scopeRoot);
    expect(history.list({ limit: 100 }).map(entry => entry.id)).toEqual([conversationId]);
    expect(history.load(conversationId!)?.messages).toHaveLength(4);
  });

  it("propagates noHistory through loaded modules without creating a conversation", async () => {
    const current = session("Hello", { noHistory: true });
    await current.agent.send("A private turn");
    await current.agent.dispose();
    expect(getScopeHistoryStore(scopeRoot).list({ limit: 100 })).toEqual([]);
  });
});
