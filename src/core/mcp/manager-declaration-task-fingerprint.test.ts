import { describe, expect, it } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./client.js";
import { McpManager } from "./manager.js";
import type {
  PersistedRemoteMcpTaskHandle,
  RemoteMcpTaskStore,
} from "./remote-task-store.js";
import {
  remoteMcpServerIdentity,
  remoteMcpTaskHandleId,
} from "./remote-task-store.js";

class CapturingRemoteTaskStore implements RemoteMcpTaskStore {
  readonly upserts: PersistedRemoteMcpTaskHandle[] = [];

  constructor(private readonly handles: PersistedRemoteMcpTaskHandle[] = []) {}

  async list(): Promise<PersistedRemoteMcpTaskHandle[]> {
    return this.handles.map((handle) => ({ ...handle }));
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

  it("keeps persisted task handles as diagnostics when the current tool declaration changed", async () => {
    const script = taskServerScript();
    const serverConfig = {
      type: "stdio" as const,
      command: "node",
      args: ["-e", script],
    };
    const identity = remoteMcpServerIdentity(serverConfig);
    const staleDeclarationFingerprint = "0".repeat(64);
    const remoteTaskStore = new CapturingRemoteTaskStore([
      {
        id: remoteMcpTaskHandleId("remote", "task-fingerprint-1"),
        serverConfigName: "remote",
        serverDisplayName: "task-fingerprint-fixture",
        serverFingerprint: identity.fingerprint,
        serverMatch: identity.match,
        toolName: "deploy",
        toolDeclarationFingerprint: staleDeclarationFingerprint,
        taskId: "task-fingerprint-1",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        status: "working",
        createdAt: "2026-05-25T12:00:00.000Z",
        lastUpdatedAt: "2026-05-25T12:00:00.000Z",
        ttlMs: null,
        pollCount: 0,
        inputUpdateCount: 0,
        startedAt: "2026-05-25T12:00:00.000Z",
        deadlineAt: null,
        updatedAt: "2026-05-25T12:00:00.000Z",
      },
    ]);
    const manager = new McpManager({ remoteTaskStore });

    try {
      await manager.initialize({
        mcpServers: {
          remote: serverConfig,
        },
      }, { inputResolverAvailable: true });

      const [resumeResult] = manager.getRemoteTaskResumeResults();
      expect(resumeResult).toMatchObject({
        kind: "diagnostic",
        serverConfigName: "remote",
        serverDisplayName: "task-fingerprint-fixture",
        tool: "deploy",
        taskId: "task-fingerprint-1",
        message: expect.stringContaining("tool declaration fingerprint"),
      });
      expect(remoteTaskStore.upserts[0]).toMatchObject({
        taskId: "task-fingerprint-1",
        lastDiagnostic: expect.stringContaining(staleDeclarationFingerprint),
      });
      expect(remoteTaskStore.upserts[0]?.lastDiagnostic).toContain(
        "current toolDeclarationFingerprint=",
      );
      expect(remoteTaskStore.upserts[0]?.lastDiagnostic).toContain(
        "different declaration",
      );
    } finally {
      await manager.close();
    }
  }, 10_000);
});
