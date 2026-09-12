import "./adapter-test-support.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAgentHarness } from "#core/agent-harness/runner.js";
import { AgentTokenBudgetLedger } from "#core/agent-harness/token-budget.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { geminiAgentHarness } from "./adapter.js";
import { captureLastCallArgs, executeToolMock, generateContentStreamMock, makeStreamFromChunks } from "./adapter-test-support.js";

it("reconstructs Gemini parts and thought signatures after a provider interruption without replaying completed tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-gemini-resume-"));
  try {
    const options = { scopeRoot: root, cwd: root, continuityKey: "workflow:gemini", model: "gemini-2.5-flash", effort: "high" as const, prompt: "remember blue" };
    generateContentStreamMock.mockResolvedValueOnce(makeStreamFromChunks([{ candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-1", name: "echo_tool", args: { text: "blue" } }, thoughtSignature: "provider-signature" }] } }] }]));
    executeToolMock.mockResolvedValue({ content: "blue", isError: false });
    generateContentStreamMock.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(runAgentHarness(geminiAgentHarness, options)).rejects.toThrow("provider unavailable");
    generateContentStreamMock.mockResolvedValueOnce(makeStreamFromChunks([{ candidates: [{ content: { role: "model", parts: [{ text: "blue remembered" }] } }] }]));
    const resumed = await runAgentHarness(geminiAgentHarness, { ...options, prompt: "continue", systemPrompt: "current instructions" });
    expect(resumed.text).toBe("blue remembered");
    expect(resumed.sessionId).toMatch(/^ots_/);
    expect(JSON.stringify(captureLastCallArgs().contents)).toContain("provider-signature");
    expect(JSON.stringify(captureLastCallArgs().contents)).toContain("functionResponse");
    expect(captureLastCallArgs().config.systemInstruction).toBe("current instructions");
    expect(JSON.stringify(captureLastCallArgs().contents)).toContain('"output":"blue"');
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    const path = join(root, ".kota/openai-tools-agent-harness/sessions", `${resumed.sessionId}.json`);
    const corrupt = { ...JSON.parse(readFileSync(path, "utf8")), adapterState: [{ parts: "invalid" }] };
    writeFileSync(path, JSON.stringify(corrupt));
    generateContentStreamMock.mockResolvedValueOnce(makeStreamFromChunks([{ candidates: [{ content: { role: "model", parts: [{ text: "recovered safely" }] } }] }]));
    const successor = await runAgentHarness(geminiAgentHarness, { ...options, prompt: "continue safely" });
    expect(successor.sessionId).not.toBe(resumed.sessionId);
    expect(JSON.stringify(captureLastCallArgs().contents)).toContain("successor conversation");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(corrupt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])("preserves the owned identity across both budget gates (tool call: %s)", async (toolCall) => {
  const root = mkdtempSync(join(tmpdir(), "kota-gemini-budget-resume-"));
  try {
    const options = { scopeRoot: root, cwd: root, continuityKey: "budget-work", sessionContext: { sessionId: "budget-session", scopeId: deriveDirectoryScopeId(root) }, model: "gemini-2.5-flash", effort: "high" as const, prompt: "Remember budget amber" };
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 10 });
    generateContentStreamMock.mockResolvedValueOnce(makeStreamFromChunks([{
      responseId: "provider-response-not-conversation",
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
      candidates: [{ content: { role: "model", parts: toolCall
        ? [{ functionCall: { id: "budget-call", name: "echo_tool", args: { text: "amber" } } }]
        : [{ text: "Amber saved" }] } }],
    }]));
    const exhausted = await runAgentHarness(geminiAgentHarness, { ...options, tokenBudget });
    expect(exhausted).toMatchObject({ isError: true, subtype: "token_budget_exhausted", turns: 1, sessionId: expect.stringMatching(/^ots_/) });
    expect(executeToolMock).not.toHaveBeenCalled();
    const beforeTurn = await geminiAgentHarness.run({ ...options, persistSession: true, resumeSessionId: exhausted.sessionId, tokenBudget, prompt: "Wait for budget" });
    expect(beforeTurn).toMatchObject({ isError: true, subtype: "token_budget_exhausted", turns: 0, sessionId: exhausted.sessionId });
    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    generateContentStreamMock.mockResolvedValueOnce(makeStreamFromChunks([{ candidates: [{ content: { role: "model", parts: [{ text: "Recovered amber" }] } }] }]));
    const resumed = await runAgentHarness(geminiAgentHarness, { ...options, prompt: "Recall" });
    expect(resumed).toMatchObject({ isError: false, sessionId: exhausted.sessionId });
    expect(JSON.stringify(captureLastCallArgs().contents)).toContain("Remember budget amber");
    expect(executeToolMock).not.toHaveBeenCalled();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
