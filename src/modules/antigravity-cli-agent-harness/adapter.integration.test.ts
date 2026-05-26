import { describe, expect, it } from "vitest";
import {
  hasAgentHarness,
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import claudeHarnessModule from "../claude-agent-harness/index.js";
import codexHarnessModule from "../codex-agent-harness/index.js";
import geminiHarnessModule from "../gemini-agent-harness/index.js";
import geminiCliHarnessModule from "../gemini-cli-agent-harness/index.js";
import openaiToolsHarnessModule from "../openai-tools-agent-harness/index.js";
import thinHarnessModule from "../thin-agent-harness/index.js";
import vercelHarnessModule from "../vercel-agent-harness/index.js";
import antigravityCliHarnessModule, {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
} from "./index.js";

describe("antigravity-cli agent harness integration", () => {
  it("registers alongside the other shipped harnesses under its declared name", () => {
    expect(claudeHarnessModule.name).toBe("claude-agent-harness");
    expect(thinHarnessModule.name).toBe("thin-agent-harness");
    expect(openaiToolsHarnessModule.name).toBe("openai-tools-agent-harness");
    expect(geminiHarnessModule.name).toBe("gemini-agent-harness");
    expect(codexHarnessModule.name).toBe("codex-agent-harness");
    expect(vercelHarnessModule.name).toBe("vercel-agent-harness");
    expect(geminiCliHarnessModule.name).toBe("gemini-cli-agent-harness");
    expect(antigravityCliHarnessModule.name).toBe(
      "antigravity-cli-agent-harness",
    );
    expect(hasAgentHarness(ANTIGRAVITY_CLI_AGENT_HARNESS_NAME)).toBe(true);
    expect(listAgentHarnessNames()).toEqual(
      expect.arrayContaining([
        "claude-agent-sdk",
        "thin",
        "openai-tools",
        "gemini",
        "codex",
        "vercel",
        "gemini-cli",
        "antigravity-cli",
      ]),
    );
    expect(resolveAgentHarness(ANTIGRAVITY_CLI_AGENT_HARNESS_NAME)).toBe(
      antigravityCliAgentHarness,
    );
  });

  it("resolves through the registry and returns the explicit unsupported execution result", async () => {
    const harness = resolveAgentHarness(ANTIGRAVITY_CLI_AGENT_HARNESS_NAME);
    const result = await harness.run({
      prompt: "say ok",
      model: "gemini-3.5-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      streamedText: "",
      turns: 0,
      isError: true,
      subtype: "antigravity_cli_headless_unsupported",
    });
  });
});
