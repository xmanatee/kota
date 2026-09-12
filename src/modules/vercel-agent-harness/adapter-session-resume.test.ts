import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it, vi } from "vitest";
import { runAgentHarness } from "#core/agent-harness/runner.js";

const provider = vi.hoisted(() => ({ model: undefined as MockLanguageModelV3 | undefined }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => provider.model }));

import { vercelAgentHarness } from "./adapter.js";

it("uses the real AI SDK to persist response messages and restore them with current instructions", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-vercel-resume-"));
  const calls: Parameters<MockLanguageModelV3["doStream"]>[0][] = [];
  provider.model = new MockLanguageModelV3({ doStream: async (options) => {
    calls.push(options);
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "text-start", id: "text" });
      controller.enqueue({ type: "text-delta", id: "text", delta: "The chosen design is blue." });
      controller.enqueue({ type: "text-end", id: "text" });
      controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });
      controller.close();
    } }) };
  } });
  try {
    const options = { scopeRoot: root, cwd: root, continuityKey: "workflow:vercel", model: "openai/test", effort: "high" as const, prompt: "choose a design" };
    const first = await runAgentHarness(vercelAgentHarness, options);
    const second = await runAgentHarness(vercelAgentHarness, { ...options, prompt: "continue", systemPrompt: "current instructions" });
    expect(second.sessionId).toBe(first.sessionId);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].prompt)).toContain("The chosen design is blue.");
    expect(calls[1].prompt[0]).toEqual({ role: "system", content: "current instructions" });
    const path = join(root, ".kota/openai-tools-agent-harness/sessions", `${first.sessionId}.json`);
    const corrupt = { ...JSON.parse(readFileSync(path, "utf8")), adapterState: { messages: "invalid" } };
    writeFileSync(path, JSON.stringify(corrupt));
    const successor = await runAgentHarness(vercelAgentHarness, { ...options, prompt: "continue safely" });
    expect(successor.sessionId).not.toBe(first.sessionId);
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(calls[2].prompt)).toContain("successor conversation");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(corrupt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
