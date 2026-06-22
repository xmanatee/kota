import { describe, expect, it } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./client.js";
import { McpManager } from "./manager.js";
import type {
  PersistedRemoteMcpTaskHandle,
  RemoteMcpTaskStore,
} from "./remote-task-store.js";

class CapturingRemoteTaskStore implements RemoteMcpTaskStore {
  readonly upserts: PersistedRemoteMcpTaskHandle[] = [];

  async list(): Promise<PersistedRemoteMcpTaskHandle[]> {
    return [];
  }

  async upsert(handle: PersistedRemoteMcpTaskHandle): Promise<void> {
    this.upserts.push({ ...handle });
  }

  async remove(): Promise<void> {}
}

function taskServerScript(): string {
  return `
    const rl = require("readline").createInterface({ input: process.stdin });
    function write(message) {
      process.stdout.write(JSON.stringify(message) + "\\n");
    }
    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === "initialize") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          protocolVersion: "DRAFT-2026-v1",
          capabilities: {
            tools: {},
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
          serverInfo: { name: "task-fingerprint-fixture" },
        }});
      } else if (msg.method === "tools/list") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          tools: [{
            name: "deploy",
            description: "Deploys a target",
            inputSchema: { type: "object" },
          }],
        }});
      } else if (msg.method === "tools/call") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          resultType: "task",
          taskId: "task-fingerprint-1",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: null,
          pollIntervalMs: 1,
        }});
      } else if (msg.method === "tasks/get") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          resultType: "task",
          taskId: "task-fingerprint-1",
          status: "completed",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:01.000Z",
          ttlMs: null,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "deployed" }],
          },
        }});
      } else if (msg.method === "shutdown") {
        write({ jsonrpc: "2.0", id: msg.id, result: {} });
      }
    });
  `;
}

describe("MCP remote task declaration fingerprints", () => {
  it("persists the declaration fingerprint captured when the task is created", async () => {
    const remoteTaskStore = new CapturingRemoteTaskStore();
    const manager = new McpManager({ remoteTaskStore });

    try {
      await manager.initialize({
        mcpServers: {
          remote: { command: "node", args: ["-e", taskServerScript()] },
        },
      }, { inputResolverAvailable: true });

      const result = await manager.executeTool("mcp__remote__deploy", {});

      expect(result.content).toBe("deployed");
      expect(remoteTaskStore.upserts[0]).toMatchObject({
        serverConfigName: "remote",
        toolName: "deploy",
        taskId: "task-fingerprint-1",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        toolDeclarationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    } finally {
      await manager.close();
    }
  }, 10_000);
});
