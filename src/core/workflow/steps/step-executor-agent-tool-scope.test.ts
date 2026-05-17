import { afterEach, describe, expect, it } from "vitest";
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { resolveAgentToolScope } from "./step-executor-agent-tool-scope.js";

const READ_TOOL = "passive_read_fixture";
const WRITE_TOOL = "passive_write_fixture";

afterEach(() => {
  deregisterTool(READ_TOOL);
  deregisterTool(WRITE_TOOL);
});

function registerFixtureTool(name: string, effect: ReturnType<typeof networkReadEffect>): void {
  registerTool(
    {
      name,
      description: "fixture tool",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    async () => ({ content: "ok" }),
    "passive-tool-scope-test",
    { effect },
  );
}

describe("resolveAgentToolScope", () => {
  it("allows registered read-effect tools in passive workflow agent steps", () => {
    registerFixtureTool(READ_TOOL, networkReadEffect());

    expect(
      resolveAgentToolScope("passive", [READ_TOOL], undefined, null),
    ).toEqual({
      allowedTools: [READ_TOOL],
      disallowedTools: undefined,
    });
  });

  it("rejects registered mutating tools in passive workflow agent steps", () => {
    registerFixtureTool(WRITE_TOOL, networkDestructiveEffect());

    expect(() =>
      resolveAgentToolScope("passive", [WRITE_TOOL], undefined, null),
    ).toThrow("Passive agent steps may only allow read-only tools");
  });
});
