import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { executeTool } from "#core/tools/index.js";
import { handleApproveAllApprovals } from "./routes.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

function makeQueue(): ApprovalQueue {
	const dir = join(
		tmpdir(),
		`kota-approvals-approve-all-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	return new ApprovalQueue(dir);
}

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

function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
	const buf = Buffer.from(JSON.stringify(body));
	let dataHandler: ((chunk: Buffer) => void) | null = null;
	let endHandler: (() => void) | null = null;
	const req = {
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
					serverInfo: { name: "approval-route-race-test" }
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

function gatedInitializeMcpServerScript(
	toolDescription: string,
	toolResult: string,
	markerPath: string,
	releasePath: string,
): string {
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
					serverInfo: { name: "approval-route-race-test" }
				}}));
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

function writeMcpConfig(projectDir: string, script: string): void {
	mkdirSync(join(projectDir, ".kota"), { recursive: true });
	writeFileSync(
		join(projectDir, ".kota", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				remote: {
					command: "node",
					args: ["-e", script],
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

async function waitForFile(path: string): Promise<void> {
	for (let attempts = 0; attempts < 200; attempts++) {
		if (existsSync(path)) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${path}`);
}

describe("approval approve-all preflight race", () => {
	let queue: ApprovalQueue;

	beforeEach(() => {
		queue = makeQueue();
		vi.mocked(executeTool).mockResolvedValue({ content: "local executed" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("leaves approvals queued during MCP preflight pending", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-approval-mcp-race-"));
		try {
			const toolDescription = "Approve-all race lookup declaration";
			writeMcpConfig(projectDir, mcpServerScript(toolDescription, "remote executed"));
			const promptFingerprint = await currentMcpFingerprint(projectDir);
			const markerPath = join(projectDir, "preflight-started.txt");
			const releasePath = join(projectDir, "release-preflight.txt");
			writeMcpConfig(
				projectDir,
				gatedInitializeMcpServerScript(
					toolDescription,
					"remote executed",
					markerPath,
					releasePath,
				),
			);
			const preflighted = queue.enqueue(
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

			const response = withCwd(projectDir, () =>
				handleApproveAllApprovals(mockRequest(), res, null, queue)
			);
			await waitForFile(markerPath);
			const queuedDuringPreflight = queue.enqueue(
				"shell",
				{ command: "late.sh" },
				"moderate",
				"queued during preflight",
			);
			writeFileSync(releasePath, "go");

			await response;

			expect(result.status).toBe(200);
			const body = result.body as {
				approvals: Array<{ id: string; status: string }>;
				count: number;
				executions: Array<{ approvalId: string; execution: { status: string } }>;
			};
			expect(body.count).toBe(1);
			expect(body.approvals.map((approval) => approval.id)).toEqual([preflighted.id]);
			expect(body.approvals[0].status).toBe("approved");
			expect(body.executions).toEqual([
				{ approvalId: preflighted.id, execution: { status: "succeeded", output: expect.any(Object) } },
			]);
			expect(queue.get(preflighted.id)?.status).toBe("approved");
			expect(queue.get(queuedDuringPreflight.id)?.status).toBe("pending");
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});
});
