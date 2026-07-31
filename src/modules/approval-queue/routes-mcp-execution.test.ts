import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApprovalQueue,
	resetApprovalQueue,
} from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { executeTool } from "#core/tools/index.js";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "#core/tools/tool-name-policy.js";
import { handleApproveApproval } from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

function mockResponse() {
	const result = { status: 0, body: null as unknown };
	const res = {
		setHeader: vi.fn(),
		writeHead: (s: number) => {
			result.status = s;
		},
		end: (data: string) => {
			result.body = JSON.parse(data);
		},
		on: vi.fn(),
	} as unknown as ServerResponse;
	return { res, result };
}

function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
	const buf = Buffer.from(JSON.stringify(body));
	let dataHandler: ((chunk: Buffer) => void) | null = null;
	let endHandler: (() => void) | null = null;
	const req = {
		url: "/approvals/abcd1234/approve",
		headers: { "content-type": "application/json" },
		on: (event: string, cb: (data?: Buffer) => void) => {
			if (event === "data") dataHandler = cb as (chunk: Buffer) => void;
			if (event === "end") endHandler = cb as () => void;
			if (dataHandler && endHandler) {
				dataHandler(buf);
				endHandler();
				dataHandler = null;
				endHandler = null;
			}
		},
	};
	return req as unknown as IncomingMessage;
}

function approvalRequest(queue: ApprovalQueue, id: string): IncomingMessage {
	const item = queue.get(id);
	if (!item) throw new Error(`Missing approval ${id}`);
	const review = queue.projectForClient(item).review;
	if (review.status !== "available") throw new Error(`Approval ${id} is not reviewable`);
	return mockRequest({ reviewDigest: review.digest });
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
	projectDir: string,
	toolDescription: string,
	toolResult = "remote executed",
	serverOverrides: Record<string, unknown> = {},
): void {
	mkdirSync(join(projectDir, ".kota"), { recursive: true });
	writeFileSync(
		join(projectDir, ".kota", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				remote: {
					command: "node",
					args: ["-e", mcpServerScript(toolDescription, toolResult)],
					...serverOverrides,
				},
			},
		}, null, 2),
	);
}

const MCP_OPERATION_TOOL_NAMES = MCP_MANAGED_OPERATION_TOOL_PREFIXES.map((prefix) => `${prefix}remote__list`);

type McpPromptSnapshot = {
	declarationFingerprint: string;
	serverTransportIdentityFingerprint: string;
};

async function currentMcpPromptSnapshot(projectDir: string): Promise<McpPromptSnapshot> {
	const config = McpManager.loadConfig(projectDir);
	if (!config) throw new Error("expected MCP test config");
	const manager = new McpManager({ projectDir });
	try {
		await manager.initialize(config);
		const declarationFingerprint = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
		const serverTransportIdentityFingerprint =
			manager.getToolServerTransportIdentityFingerprint("mcp__remote__lookup");
		if (!declarationFingerprint) throw new Error("expected MCP declaration fingerprint");
		if (!serverTransportIdentityFingerprint) throw new Error("expected MCP server transport identity fingerprint");
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

	it.each(MCP_OPERATION_TOOL_NAMES)(
		"rejects MCP operation approval %s before local execution",
		async (toolName) => {
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
		},
	);

	it("rejects an MCP approval without stored prompt declaration metadata before local execution", async () => {
		const item = queue.enqueue("mcp__remote__lookup", { query: "deploy" }, "moderate", "remote lookup");
		const { res, result } = mockResponse();

		await handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue);

		expect(result.status).toBe(409);
		expect(result.body).toMatchObject({ reason: "mcp_approval_missing_declaration" });
		expect(queue.get(item.id)?.status).toBe("pending");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("rejects a stale MCP approval before local execution", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-approval-mcp-stale-"));
		try {
			writeMcpConfig(projectDir, "Current lookup declaration");
			const currentSnapshot = await currentMcpPromptSnapshot(projectDir);
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

			await withCwd(projectDir, () =>
				handleApproveApproval(approvalRequest(queue, item.id), res, item.id, null, queue)
			);

			expect(result.status).toBe(409);
			expect(result.body).toMatchObject({
				reason: "mcp_declaration_changed_since_prompt",
				mcp: {
					tool: "mcp__remote__lookup",
					promptDeclarationFingerprintPrefix: promptFingerprint.slice(0, 12),
					currentDeclarationFingerprintPrefix: currentSnapshot.declarationFingerprint.slice(0, 12),
					promptServerTransportIdentityFingerprintPrefix:
						serverTransportIdentityFingerprint.slice(0, 12),
				},
			});
			expect(queue.get(item.id)?.status).toBe("pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});
});
