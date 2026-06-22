import { describe, expect, it } from "vitest";
import type { McpToolSchema } from "./client.js";
import {
  changedMcpToolDeclarationFacets,
  fingerprintMcpToolDeclaration,
} from "./tool-declaration-fingerprint.js";

const baseTool: McpToolSchema = {
  name: "lookup",
  description: "Looks up a record",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

function declaration(tool: McpToolSchema) {
  return fingerprintMcpToolDeclaration({
    serverConfigName: "remote",
    serverDisplayName: "remote-display",
    tool,
    tasksSupported: true,
  });
}

describe("MCP tool declaration fingerprint helper", () => {
  it("changes on advertised declaration facets and ignores object key order", () => {
    const orderedDifferently: McpToolSchema = {
      ...baseTool,
      inputSchema: {
        required: ["query"],
        properties: {
          limit: { type: "number" },
          query: { description: "Search query", type: "string" },
        },
        type: "object",
      },
      outputSchema: {
        required: ["answer"],
        properties: { answer: { type: "string" } },
        type: "object",
      },
    };
    expect(declaration(orderedDifferently).fingerprint).toBe(
      declaration(baseTool).fingerprint,
    );

    const variants: Array<[string, McpToolSchema]> = [
      ["description", { ...baseTool, description: "Looks up a changed record" }],
      [
        "inputSchema",
        {
          ...baseTool,
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" }, exact: { type: "boolean" } },
            required: ["query"],
          },
        },
      ],
      [
        "outputSchema",
        {
          ...baseTool,
          outputSchema: {
            type: "object",
            properties: { answer: { type: "string" }, score: { type: "number" } },
            required: ["answer"],
          },
        },
      ],
      ["annotations", { ...baseTool, annotations: { readOnlyHint: true } }],
    ];

    const before = declaration(baseTool);
    for (const [facet, tool] of variants) {
      const after = declaration(tool);
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(changedMcpToolDeclarationFacets(before, after)).toContain(facet);
    }
  });
});
