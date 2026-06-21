import { describe, expect, it } from "vitest";
import {
  SecurityLogEmitter,
  type SecurityLogExporter,
  type SecurityLogRecord,
} from "./security-logs.js";

class FakeSecurityLogExporter implements SecurityLogExporter {
  readonly records: SecurityLogRecord[] = [];

  async export(records: readonly SecurityLogRecord[]): Promise<void> {
    this.records.push(...records);
  }
}

describe("SecurityLogEmitter MCP injection events", () => {
  it("marks MCP-shaped injection-defense assessments with server and tool metadata", () => {
    const exporter = new FakeSecurityLogExporter();
    const emitter = new SecurityLogEmitter(process.cwd(), exporter);

    emitter.onInjectionDefenseAssessed({
      tool: "mcp__github__get_issue",
      suspicious: true,
      reasons: ["role-marker", "override-phrase"],
      action: "annotate",
      autonomyMode: "autonomous",
      session: "session-1",
    });

    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].attributes).toMatchObject({
      "tool.name": "mcp__github__get_issue",
      "injection.suspicious": true,
      "injection.reason_count": 2,
      "injection.reason_tags": "role-marker,override-phrase",
      "autonomy_mode": "autonomous",
      "session.id": "session-1",
      "tool.mcp": true,
      "mcp.server": "github",
      "mcp.tool": "get_issue",
    });
  });
});
