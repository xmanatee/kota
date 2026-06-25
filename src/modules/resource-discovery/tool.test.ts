import { describe, expect, it } from "vitest";
import type { ResourceDiscoveryProvider, ResourceDiscoveryResult } from "./client.js";
import { createResourceDiscoveryToolRunner, resourceDiscoveryTool } from "./tool.js";

const sampleResult: ResourceDiscoveryResult = {
  ok: true,
  query: "send a Slack approval",
  degradation: "keyword_only",
  hits: [
    {
      kind: "tool",
      id: "tool:slack_send",
      name: "slack_send",
      title: "slack_send",
      description: "Send a Slack approval prompt.",
      score: 10,
      why: ["description matched slack"],
      readiness: { status: "ready", message: "Resource is available." },
      ownerModule: "slack-channel",
      inspectPath: "tool:slack_send",
      accessHint: "Call through normal tool policy.",
      tags: [],
      metadata: {},
    },
  ],
};

function provider(): ResourceDiscoveryProvider {
  return {
    async discover() {
      return sampleResult;
    },
  };
}

describe("resource_discovery tool", () => {
  it("declares a read-only advisory discovery schema", () => {
    expect(resourceDiscoveryTool.name).toBe("resource_discovery");
    expect(resourceDiscoveryTool.input_schema.required).toEqual(["query"]);
    const kinds = (resourceDiscoveryTool.input_schema.properties.kinds as {
      items: { enum: string[] };
    }).items.enum;
    expect(kinds).toContain("tool");
    expect(kinds).toContain("setup-requirement");
    expect(kinds).toContain("mcp-server");
  });

  it("returns the shared provider envelope as structured tool content", async () => {
    const runner = createResourceDiscoveryToolRunner(provider);
    const result = await runner({
      query: "send a Slack approval",
      kinds: ["tool"],
      limit: 1,
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("slack_send");
    expect(result.structuredContent).toEqual(sampleResult);
  });

  it("rejects invalid kinds before reaching the provider", async () => {
    const runner = createResourceDiscoveryToolRunner(provider);
    const result = await runner({
      query: "x",
      kinds: ["not-a-kind"],
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`kinds` must contain");
  });
});
