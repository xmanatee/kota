import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { executeTool } from "#core/tools/index.js";
import { handleApproveApproval } from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

function mockResponse() {
	const result = { status: 0, body: null as unknown };
	const res = {
		setHeader: vi.fn(),
		writeHead: (status: number) => {
			result.status = status;
		},
		end: (data: string) => {
			result.body = JSON.parse(data);
		},
		on: vi.fn(),
	} as unknown as ServerResponse;
	return { res, result };
}

function mockRequest(reviewDigest: string): IncomingMessage {
	const body = Buffer.from(JSON.stringify({ reviewDigest }));
	let dataHandler: ((chunk: Buffer) => void) | null = null;
	let endHandler: (() => void) | null = null;
	return {
		headers: { "content-type": "application/json" },
		on: (event: string, callback: (data?: Buffer) => void) => {
			if (event === "data") dataHandler = callback as (chunk: Buffer) => void;
			if (event === "end") endHandler = callback as () => void;
			if (dataHandler && endHandler) {
				dataHandler(body);
				endHandler();
				dataHandler = null;
				endHandler = null;
			}
		},
	} as unknown as IncomingMessage;
}

function gatedMcpServerScript(markerPath: string, releasePath: string): string {
	return `
		const fs = require("fs");
		const readline = require("readline");
		const rl = readline.createInterface({ input: process.stdin });
		const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
		const waitForRelease = (callback) => {
			fs.writeFileSync(${JSON.stringify(markerPath)}, "waiting");
			const timer = setInterval(() => {
				if (!fs.existsSync(${JSON.stringify(releasePath)})) return;
				clearInterval(timer);
				callback();
			}, 5);
		};
		rl.on("line", (line) => {
			let msg;
			try { msg = JSON.parse(line); } catch { return; }
			if (msg.method === "initialize") {
				waitForRelease(() => write({ jsonrpc: "2.0", id: msg.id, result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "approval-descriptor-race-test" }
				}}));
			} else if (msg.method === "tools/list") {
				write({ jsonrpc: "2.0", id: msg.id, result: {
					tools: [{ name: "lookup", description: "Stable lookup", inputSchema: { type: "object" } }]
				}});
			} else if (msg.method === "tools/call") {
				write({ jsonrpc: "2.0", id: msg.id, result: {
					content: [{ type: "text", text: "remote executed" }]
				}});
			} else if (msg.method === "shutdown") {
				write({ jsonrpc: "2.0", id: msg.id, result: {} });
			} else if (msg.method === "exit") {
				process.exit(0);
			}
		});
	`;
}

function writeMcpConfig(projectDir: string, script: string): void {
	mkdirSync(join(projectDir, ".kota"), { recursive: true });
	writeFileSync(join(projectDir, ".kota", "mcp.json"), JSON.stringify({
		mcpServers: { remote: { command: "node", args: ["-e", script] } },
	}, null, 2));
}

async function currentMcpPromptSnapshot(projectDir: string): Promise<{
	declarationFingerprint: string;
	serverTransportIdentityFingerprint: string;
}> {
	const config = McpManager.loadConfig(projectDir);
	if (!config) throw new Error("expected MCP test config");
	const manager = new McpManager({ projectDir });
	try {
		await manager.initialize(config);
		const declarationFingerprint = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
		const serverTransportIdentityFingerprint =
			manager.getToolServerTransportIdentityFingerprint("mcp__remote__lookup");
		if (!declarationFingerprint || !serverTransportIdentityFingerprint) {
			throw new Error("expected MCP prompt fingerprints");
		}
		return { declarationFingerprint, serverTransportIdentityFingerprint };
	} finally {
		await manager.close();
	}
}

async function waitForFile(path: string): Promise<void> {
	for (let attempts = 0; attempts < 200; attempts++) {
		if (existsSync(path)) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${path}`);
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
	const originalCwd = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(originalCwd);
	}
}

describe("approval descriptor preflight race", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a stored tool substitution during delayed MCP preflight", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-approval-mcp-substitution-"));
		const queueDir = mkdtempSync(join(tmpdir(), "kota-approval-queue-substitution-"));
		const queue = new ApprovalQueue(queueDir);
		try {
			const markerPath = join(projectDir, "preflight-started.txt");
			const releasePath = join(projectDir, "release-preflight.txt");
			writeMcpConfig(projectDir, gatedMcpServerScript(markerPath, releasePath));
			writeFileSync(releasePath, "prompt");
			const promptSnapshot = await currentMcpPromptSnapshot(projectDir);
			rmSync(releasePath, { force: true });
			rmSync(markerPath, { force: true });
			const item = queue.enqueue(
				"mcp__remote__lookup",
				{ query: "deploy" },
				"moderate",
				"remote lookup",
				undefined,
				undefined,
				undefined,
				undefined,
				"session-approved",
				{
					server: "remote",
					tool: "lookup",
					promptDeclarationFingerprint: promptSnapshot.declarationFingerprint,
					serverTransportIdentityFingerprint:
						promptSnapshot.serverTransportIdentityFingerprint,
				},
			);
			const { res, result } = mockResponse();
			const review = queue.projectForClient(item).review;
			if (review.status !== "available") throw new Error("expected review descriptor");
			await withCwd(projectDir, async () => {
				const response = handleApproveApproval(
					mockRequest(review.digest),
					res,
					item.id,
					null,
					queue,
				);
				await waitForFile(markerPath);
				const approvalPath = join(queueDir, `${item.id}.json`);
				const substituted = JSON.parse(readFileSync(approvalPath, "utf8")) as { tool: string };
				substituted.tool = "shell";
				writeFileSync(approvalPath, JSON.stringify(substituted, null, 2));
				writeFileSync(releasePath, "go");
				await response;
			});

			expect(result.status).toBe(409);
			expect(result.body).toMatchObject({
				reason: "approval_execution_descriptor_mismatch",
				approvals: [{ id: item.id, tool: "shell", status: "pending" }],
			});
			expect(queue.get(item.id)).toMatchObject({ tool: "shell", status: "pending" });
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
			rmSync(queueDir, { recursive: true, force: true });
		}
	});
});
