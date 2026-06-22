import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAgentStatusProviders,
  runAgentStatus,
  setToolDescriptionQualityProvider,
} from "./agent-status.js";
import { readOnlyLocalEffect } from "./effect.js";
import { clearCustomTools, registerTool } from "./index.js";

describe("agent_status description-quality diagnostics", () => {
  beforeEach(() => {
    resetAgentStatusProviders();
  });

  afterEach(() => {
    resetAgentStatusProviders();
    clearCustomTools();
  });

  it("shows bounded description-quality diagnostics for matching local tools", async () => {
    registerTool(
      {
        name: "weak_quality",
        description: "Do it",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "ok" }),
      "quality-test",
      { effect: readOnlyLocalEffect() },
    );

    const result = await runAgentStatus({ query: "tools", filter: "weak_quality" });

    expect(result.content).toContain("Description diagnostics");
    expect(result.content).toContain("weak_quality [local]");
    expect(result.content).toContain("description-too-short");
    expect(result.content).not.toContain("raw tool payload");
  });

  it("shows remote MCP description diagnostics from the live provider", async () => {
    setToolDescriptionQualityProvider(() => [{
      source: "remote-mcp",
      toolName: "mcp__remote__lookup",
      serverConfigName: "remote",
      serverDisplayName: "Remote MCP",
      declarationFingerprint: "fingerprint",
      diagnostics: [{
        code: "description-missing",
        message: "Description is missing; agents cannot infer the tool's purpose.",
      }],
    }]);

    const result = await runAgentStatus({ query: "tools", filter: "mcp__remote__lookup" });

    expect(result.content).toContain("Description diagnostics");
    expect(result.content).toContain("mcp__remote__lookup [remote-mcp:remote]");
    expect(result.content).toContain("description-missing");
    expect(result.content).not.toContain("no tools match filter");
  });
});
