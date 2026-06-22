import { describe, expect, it } from "vitest";
import { ToolTelemetry } from "./tool-telemetry.js";

function recordResult(telemetry: ToolTelemetry, toolUseId: string, tool: string): void {
  telemetry.recordCallStart({ toolUseId, tool, inputBytes: 0 });
  telemetry.recordCallResult({
    toolUseId,
    tool,
    durationMs: 10,
    success: true,
    resultBytes: 20,
    resultContentKind: "text",
    truncated: false,
  });
}

describe("ToolTelemetry MCP provenance", () => {
  it("infers external MCP provenance for dynamic tool and operation names", () => {
    const telemetry = new ToolTelemetry();

    recordResult(telemetry, "tool-1", "mcp__remote__lookup");
    recordResult(telemetry, "tool-2", "mcp_resources__remote__read");
    recordResult(telemetry, "tool-3", "mcp__kota_owner_questions__ask_owner");

    expect(telemetry.getCallRecords()).toEqual([
      expect.objectContaining({
        resultContentProvenance: {
          kind: "external-mcp",
          serverName: "remote",
          source: "tool",
          name: "lookup",
        },
      }),
      expect.objectContaining({
        resultContentProvenance: {
          kind: "external-mcp",
          serverName: "remote",
          source: "operation",
          name: "resources/read",
        },
      }),
      expect.not.objectContaining({
        resultContentProvenance: expect.anything(),
      }),
    ]);
  });

  it("preserves explicit MCP declaration fingerprints on call records", () => {
    const telemetry = new ToolTelemetry();
    telemetry.recordCallStart({
      toolUseId: "tool-1",
      tool: "mcp__remote__lookup",
      inputBytes: 0,
    });
    telemetry.recordCallResult({
      toolUseId: "tool-1",
      tool: "mcp__remote__lookup",
      durationMs: 10,
      success: true,
      resultBytes: 20,
      resultContentKind: "text",
      truncated: false,
      resultContentProvenance: {
        kind: "external-mcp",
        serverName: "remote",
        source: "tool",
        name: "lookup",
        declarationFingerprint: "declaration-fp",
      },
    });

    expect(telemetry.getCallRecords()[0]).toMatchObject({
      resultContentProvenance: {
        kind: "external-mcp",
        serverName: "remote",
        source: "tool",
        name: "lookup",
        declarationFingerprint: "declaration-fp",
      },
    });
  });
});
