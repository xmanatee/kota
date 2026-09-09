import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { executeTool } from "#core/tools/index.js";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "#core/tools/tool-name-policy.js";
import { mockRequest, mockResponse } from "./approval-route-test-support.integration.js";

import { approvalControlRoutes, handleApproveApproval } from "./routes.js";

function approvalRequest(queue: ApprovalQueue, id: string): IncomingMessage {
  const item = queue.get(id);
  if (!item) throw new Error(`Missing approval ${id}`);
  const review = queue.projectForClient(item).review;
  if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
  return mockRequest({ reviewDigest: review.digest }, "/approvals/abcd1234/approve");
}

function mcpServerScript(toolDescription: string, toolResult: string): string {
  return `
		const readline = require("readline");
		const rl = readline.createInterface({ input: process.stdin });
		const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
		rl.on("line", (line) => {
			let msg;
			try { msg = JSON.parse(line); } catch { return; }
			if (msg.method === "initialize") {
				write({ jsonrpc: "2.0", id: msg.id, result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "approval-route-test" }
				}});
			} else if (msg.method === "tools/list") {
				write({ jsonrpc: "2.0", id: msg.id, result: {
					tools: [{ name: "lookup", description: ${JSON.stringify(toolDescription)}, inputSchema: { type: "object" } }]
				}});
			} else if (msg.method === "tools/call" && msg.params.name === "lookup") {
				write({ jsonrpc: "2.0", id: msg.id, result: {
					content: [{ type: "text", text: ${JSON.stringify(toolResult)} }]
				}});
			} else if (msg.method === "shutdown") {
				write({ jsonrpc: "2.0", id: msg.id, result: {} });
			} else if (msg.method === "exit") {
				process.exit(0);
			}
		});
	`;
}

function writeMcpConfig(
  scopeRoot: string,
  toolDescription: string,
  toolResult = "remote executed",
  serverOverrides: Record<string, unknown> = {},
): void {
  mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
  writeFileSync(
    join(scopeRoot, ".kota", "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          remote: {
            command: "node",
            args: ["-e", mcpServerScript(toolDescription, toolResult)],
            ...serverOverrides,
          },
        },
      },
      null,
      2,
    ),
  );
}

const MCP_OPERATION_TOOL_NAMES = MCP_MANAGED_OPERATION_TOOL_PREFIXES.map(
  (prefix) => `${prefix}remote__list`,
);

type McpPromptSnapshot = {
  declarationFingerprint: string;
  serverTransportIdentityFingerprint: string;
};

async function currentMcpPromptSnapshot(scopeRoot: string): Promise<McpPromptSnapshot> {
  const config = McpManager.loadConfig(scopeRoot);
  if (!config) throw new Error("expected MCP test config");
  const manager = new McpManager({ scopeRoot });
  try {
    await manager.initialize(config);
    const declarationFingerprint = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
    const serverTransportIdentityFingerprint =
      manager.getToolServerTransportIdentityFingerprint("mcp__remote__lookup");
    if (!declarationFingerprint) throw new Error("expected MCP declaration fingerprint");
    if (!serverTransportIdentityFingerprint)
      throw new Error("expected MCP server transport identity fingerprint");
    return { declarationFingerprint, serverTransportIdentityFingerprint };
  } finally {
    await manager.close();
  }
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

vi.mock("#core/tools/index.js", () => ({
  executeTool: vi.fn(),
}));

describe("approval route MCP execution", () => {
  let queueDir: string;
  let queue: ApprovalQueue;
  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), "kota-approvals-mcp-"));
    queue = new ApprovalQueue(queueDir);
    vi.mocked(executeTool).mockResolvedValue({ content: "local shadow" });
  });
  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    resetApprovalQueue();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it.each(
    MCP_OPERATION_TOOL_NAMES,
  )("rejects MCP operation approval %s before local execution", async (toolName) => {
    const item = queue.enqueue(toolName, {}, "moderate", "remote operation");
    const { res, result } = mockResponse();

    await handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      reason: "mcp_approval_missing_declaration",
      mcp: { tool: toolName },
    });
    expect(queue.get(item.id)?.status).toBe("pending");
    expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
  });

  it("rejects an MCP approval without stored prompt declaration metadata before local execution", async () => {
    const item = queue.enqueue(
      "mcp__remote__lookup",
      { query: "deploy" },
      "moderate",
      "remote lookup",
    );
    const { res, result } = mockResponse();

    await handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ reason: "mcp_approval_missing_declaration" });
    expect(queue.get(item.id)?.status).toBe("pending");
    expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
  });

  it("rejects a stale MCP approval before local execution", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-approval-mcp-stale-"));
    try {
      writeMcpConfig(scopeRoot, "Current lookup declaration");
      const currentSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      const promptFingerprint = "a".repeat(64);
      const serverTransportIdentityFingerprint = "b".repeat(64);
      const item = queue.enqueue(
        "mcp__remote__lookup",
        { query: "deploy" },
        "moderate",
        "remote lookup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          server: "remote",
          tool: "lookup",
          promptDeclarationFingerprint: promptFingerprint,
          serverTransportIdentityFingerprint,
        },
      );
      const { res, result } = mockResponse();

      await withCwd(scopeRoot, () =>
        handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue),
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        reason: "mcp_server_transport_changed_since_prompt",
        mcp: {
          tool: "mcp__remote__lookup",
          promptDeclarationFingerprintPrefix: promptFingerprint.slice(0, 12),
          promptServerTransportIdentityFingerprintPrefix: serverTransportIdentityFingerprint.slice(
            0,
            12,
          ),
          currentServerTransportIdentityFingerprintPrefix:
            currentSnapshot.serverTransportIdentityFingerprint.slice(0, 12),
        },
      });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects an MCP approval when the server transport identity changed under the same tool declaration", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-approval-mcp-transport-"));
    try {
      const toolDescription = "Stable lookup declaration";
      writeMcpConfig(scopeRoot, toolDescription, "old remote");
      const promptSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      writeMcpConfig(scopeRoot, toolDescription, "new remote");
      const currentSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      expect(currentSnapshot.declarationFingerprint).toBe(promptSnapshot.declarationFingerprint);
      expect(currentSnapshot.serverTransportIdentityFingerprint).not.toBe(
        promptSnapshot.serverTransportIdentityFingerprint,
      );
      const item = queue.enqueue(
        "mcp__remote__lookup",
        { query: "deploy" },
        "moderate",
        "remote lookup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          server: "remote",
          tool: "lookup",
          promptDeclarationFingerprint: promptSnapshot.declarationFingerprint,
          serverTransportIdentityFingerprint: promptSnapshot.serverTransportIdentityFingerprint,
        },
      );
      const { res, result } = mockResponse();

      await withCwd(scopeRoot, () =>
        handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue),
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        reason: "mcp_server_transport_changed_since_prompt",
        mcp: {
          tool: "mcp__remote__lookup",
          promptDeclarationFingerprintPrefix: promptSnapshot.declarationFingerprint.slice(0, 12),
          promptServerTransportIdentityFingerprintPrefix:
            promptSnapshot.serverTransportIdentityFingerprint.slice(0, 12),
          currentServerTransportIdentityFingerprintPrefix:
            currentSnapshot.serverTransportIdentityFingerprint.slice(0, 12),
        },
      });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("rejects an MCP approval when redacted transport metadata cannot safely pin env values", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-approval-mcp-ambiguous-"));
    try {
      writeMcpConfig(scopeRoot, "Env lookup declaration", "remote executed", {
        env: { KOTA_MCP_TOKEN: "one" },
      });
      const promptSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      const item = queue.enqueue(
        "mcp__remote__lookup",
        { query: "deploy" },
        "moderate",
        "remote lookup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          server: "remote",
          tool: "lookup",
          promptDeclarationFingerprint: promptSnapshot.declarationFingerprint,
          serverTransportIdentityFingerprint: promptSnapshot.serverTransportIdentityFingerprint,
        },
      );
      const { res, result } = mockResponse();

      await withCwd(scopeRoot, () =>
        handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue),
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        reason: "mcp_server_transport_identity_ambiguous",
        mcp: {
          tool: "mcp__remote__lookup",
          promptServerTransportIdentityFingerprintPrefix:
            promptSnapshot.serverTransportIdentityFingerprint.slice(0, 12),
          currentServerTransportIdentityFingerprintPrefix:
            promptSnapshot.serverTransportIdentityFingerprint.slice(0, 12),
          message: expect.stringContaining("stdio environment values"),
        },
      });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("executes a fresh MCP approval through the MCP manager", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-approval-mcp-fresh-"));
    try {
      writeMcpConfig(scopeRoot, "Fresh lookup declaration", "remote executed");
      const promptSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      const item = queue.enqueue(
        "mcp__remote__lookup",
        { query: "deploy" },
        "moderate",
        "remote lookup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          server: "remote",
          tool: "lookup",
          promptDeclarationFingerprint: promptSnapshot.declarationFingerprint,
          serverTransportIdentityFingerprint: promptSnapshot.serverTransportIdentityFingerprint,
        },
      );
      const { res, result } = mockResponse();

      await withCwd(scopeRoot, () =>
        handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue),
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        approval: { id: item.id, status: "approved" },
        resolution: {
          kind: "tool_execution",
          execution: { status: "succeeded" },
        },
      });
      expect(queue.get(item.id)?.status).toBe("approved");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("applies MCP preflight before daemon-control approval mutation", async () => {
    const item = queue.enqueue(
      "mcp__remote__lookup",
      { query: "deploy" },
      "moderate",
      "remote lookup",
    );
    setApprovalQueueInstance(queue);
    const route = approvalControlRoutes().find(
      (candidate) => candidate.path === "/approvals/:id/approve",
    );
    if (!route) throw new Error("expected approval control route");
    const { res, result } = mockResponse();

    await route.handler(approvalRequest(queue, item.id), res, { id: item.id });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ reason: "mcp_approval_missing_declaration" });
    expect(queue.get(item.id)?.status).toBe("pending");
    expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
  });

  it("rejects a rewritten MCP config and pending declaration before preflight", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-approval-mcp-rewritten-"));
    try {
      writeMcpConfig(scopeRoot, "Reviewed lookup declaration", "reviewed implementation");
      const reviewedSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      const item = queue.enqueue(
        "mcp__remote__lookup",
        { query: "deploy" },
        "moderate",
        "remote lookup",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          server: "remote",
          tool: "lookup",
          promptDeclarationFingerprint: reviewedSnapshot.declarationFingerprint,
          serverTransportIdentityFingerprint: reviewedSnapshot.serverTransportIdentityFingerprint,
        },
      );
      const review = queue.projectForClient(item).review;
      if (review.status !== "available") throw new Error("expected review descriptor");

      writeMcpConfig(scopeRoot, "Attacker lookup declaration", "attacker implementation");
      const attackerSnapshot = await currentMcpPromptSnapshot(scopeRoot);
      const approvalPath = join(queueDir, `${item.id}.json`);
      const stored = JSON.parse(readFileSync(approvalPath, "utf8")) as {
        mcpPromptDeclaration: {
          promptDeclarationFingerprint: string;
          serverTransportIdentityFingerprint: string;
        };
      };
      stored.mcpPromptDeclaration.promptDeclarationFingerprint =
        attackerSnapshot.declarationFingerprint;
      stored.mcpPromptDeclaration.serverTransportIdentityFingerprint =
        attackerSnapshot.serverTransportIdentityFingerprint;
      writeFileSync(approvalPath, JSON.stringify(stored, null, 2));
      const { res, result } = mockResponse();

      await withCwd(scopeRoot, () =>
        handleApproveApproval(
          mockRequest({ reviewDigest: review.digest }),
          res,
          item.id,
          null,
          queue,
        ),
      );

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        reason: "approval_execution_descriptor_mismatch",
        approvals: [{ id: item.id, status: "pending" }],
      });
      expect(queue.get(item.id)?.status).toBe("pending");
      expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
