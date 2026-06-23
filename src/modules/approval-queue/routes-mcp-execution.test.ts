import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
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
import { approvalControlRoutes, handleApproveApproval } from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

function makeQueue(): ApprovalQueue {
	const dir = join(tmpdir(), `kota-approvals-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	return new ApprovalQueue(dir);
}

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

function writeMcpConfig(projectDir: string, toolDescription: string, toolResult = "remote executed"): void {
	mkdirSync(join(projectDir, ".kota"), { recursive: true });
	writeFileSync(
		join(projectDir, ".kota", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				remote: {
					command: "node",
					args: ["-e", mcpServerScript(toolDescription, toolResult)],
				},
			},
		}, null, 2),
	);
}

async function currentMcpFingerprint(projectDir: string): Promise<string> {
	const config = McpManager.loadConfig(projectDir);
	if (!config) throw new Error("expected MCP test config");
	const manager = new McpManager({ projectDir });
	try {
		await manager.initialize(config);
		const fingerprint = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
		if (!fingerprint) throw new Error("expected MCP declaration fingerprint");
		return fingerprint;
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
	let queue: ApprovalQueue;

	beforeEach(() => {
		queue = makeQueue();
		vi.mocked(executeTool).mockResolvedValue({ content: "local shadow" });
	});

	afterEach(() => {
		resetApprovalQueue();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("rejects an MCP approval without stored prompt declaration metadata before local execution", async () => {
		const item = queue.enqueue("mcp__remote__lookup", { query: "deploy" }, "moderate", "remote lookup");
		const { res, result } = mockResponse();

		await handleApproveApproval(mockRequest(), res, item.id, null, queue);

		expect(result.status).toBe(409);
		expect(result.body).toMatchObject({ reason: "mcp_approval_missing_declaration" });
		expect(queue.get(item.id)?.status).toBe("pending");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("rejects a stale MCP approval before local execution", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-approval-mcp-stale-"));
		try {
			writeMcpConfig(projectDir, "Current lookup declaration");
			const currentFingerprint = await currentMcpFingerprint(projectDir);
			const promptFingerprint = "a".repeat(64);
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
				{ server: "remote", tool: "lookup", promptDeclarationFingerprint: promptFingerprint },
			);
			const { res, result } = mockResponse();

			await withCwd(projectDir, () =>
				handleApproveApproval(mockRequest(), res, item.id, null, queue)
			);

			expect(result.status).toBe(409);
			expect(result.body).toMatchObject({
				reason: "mcp_declaration_changed_since_prompt",
				mcp: {
					tool: "mcp__remote__lookup",
					promptDeclarationFingerprintPrefix: promptFingerprint.slice(0, 12),
					currentDeclarationFingerprintPrefix: currentFingerprint.slice(0, 12),
				},
			});
			expect(queue.get(item.id)?.status).toBe("pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("executes a fresh MCP approval through the MCP manager", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-approval-mcp-fresh-"));
		try {
			writeMcpConfig(projectDir, "Fresh lookup declaration", "remote executed");
			const promptFingerprint = await currentMcpFingerprint(projectDir);
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
				{ server: "remote", tool: "lookup", promptDeclarationFingerprint: promptFingerprint },
			);
			const { res, result } = mockResponse();

			await withCwd(projectDir, () =>
				handleApproveApproval(mockRequest(), res, item.id, null, queue)
			);

			expect(result.status).toBe(200);
			expect(result.body).toMatchObject({
				approval: { id: item.id, status: "approved" },
				execution: { status: "succeeded" },
			});
			expect(queue.get(item.id)?.status).toBe("approved");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("applies MCP preflight before daemon-control approval mutation", async () => {
		const item = queue.enqueue("mcp__remote__lookup", { query: "deploy" }, "moderate", "remote lookup");
		setApprovalQueueInstance(queue);
		const route = approvalControlRoutes().find((candidate) => candidate.path === "/approvals/:id/approve");
		if (!route) throw new Error("expected approval control route");
		const { res, result } = mockResponse();

		await route.handler(mockRequest(), res, { id: item.id });

		expect(result.status).toBe(409);
		expect(result.body).toMatchObject({ reason: "mcp_approval_missing_declaration" });
		expect(queue.get(item.id)?.status).toBe("pending");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});
});
