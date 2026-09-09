import { describe, expect, it } from "vitest";
import { getPreset } from "#core/model/preset.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";
import { resolveHarnessModel } from "./harness-model-resolution.js";

describe("adapter-owned model routing", () => {
  it("normalizes provider models at the native versus ModelClient boundary", () => {
    const model = getPreset("codex").defaultModel;
    expect(resolveHarnessModel(codexAgentHarness, `openai/${model}`, "openai")).toBe(model);
    expect(resolveHarnessModel(claudeAgentHarness, `anthropic/${getPreset("claude").defaultModel}`, "anthropic")).toBe(getPreset("claude").defaultModel);
    expect(resolveHarnessModel(openaiToolsAgentHarness, "ollama/operator-model", "ollama")).toBe("ollama/operator-model");
    expect(resolveHarnessModel(openaiToolsAgentHarness, "openrouter/z-ai/glm-5.2", "openrouter")).toBe("openrouter/z-ai/glm-5.2");
  });

  it("rejects mismatched providers and adapter-owned unsupported tool models without launching", () => {
    expect(() => resolveHarnessModel(codexAgentHarness, "openrouter/z-ai/glm-5.2", "openrouter")).toThrow('not "openrouter"');
    expect(() => resolveHarnessModel(openaiToolsAgentHarness, "ollama/model", "openrouter")).toThrow("conflicts");
    expect(() => resolveHarnessModel(openaiToolsAgentHarness, "missing/model", "missing")).toThrow("Unknown ModelClient provider");
    expect(() => resolveHarnessModel(openaiToolsAgentHarness, "openai/gpt-5.6", "openai")).toThrow("incompatible with OpenAI Chat Completions");
  });
});
