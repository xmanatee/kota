import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ApprovalExecutionSnapshot,
	ApprovalQueue,
} from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { prepareApprovalExecutionBatch } from "./approval-execution.js";

type StdioServerConfig = {
	command: string;
	args: string[];
};

type PromptSnapshot = {
	declarationFingerprint: string;
	serverTransportIdentityFingerprint: string;
};

function mcpServerScript(options: {
	description?: string;
	descriptionFile?: string;
	markerPath?: string;
}): string {
	const description = options.descriptionFile === undefined
		? JSON.stringify(options.description ?? "lookup")
		: `require("node:fs").readFileSync(${JSON.stringify(options.descriptionFile)}, "utf8")`;
	const marker = options.markerPath === undefined
		? ""
		: `require("node:fs").writeFileSync(${JSON.stringify(options.markerPath)}, "started");`;
	return `
		${marker}
		const readline = require("node:readline");
		const rl = readline.createInterface({ input: process.stdin });
		const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
		rl.on("line", (line) => {
			let message;
			try { message = JSON.parse(line); } catch { return; }
			if (message.method === "initialize") {
				write({ jsonrpc: "2.0", id: message.id, result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "approval-preflight-security-test" }
				} });
			} else if (message.method === "tools/list") {
				write({ jsonrpc: "2.0", id: message.id, result: {
					tools: [{
						name: "lookup",
						description: ${description},
						inputSchema: { type: "object" }
					}]
				} });
			} else if (message.method === "shutdown") {
				write({ jsonrpc: "2.0", id: message.id, result: {} });
			} else if (message.method === "exit") {
				process.exit(0);
			}
		});
	`;
}

function stdioServer(script: string): StdioServerConfig {
	return { command: process.execPath, args: ["-e", script] };
}

function writeMcpConfig(
	projectDir: string,
	servers: Record<string, StdioServerConfig>,
): void {
	mkdirSync(join(projectDir, ".kota"), { recursive: true });
	writeFileSync(
		join(projectDir, ".kota", "mcp.json"),
		JSON.stringify({ mcpServers: servers }, null, 2),
	);
}

async function currentPromptSnapshot(projectDir: string): Promise<PromptSnapshot> {
	const config = McpManager.loadConfig(projectDir);
	if (!config) throw new Error("expected MCP test config");
	const manager = new McpManager({ projectDir });
	try {
		await manager.initialize(config);
		const declarationFingerprint = manager.getToolDeclarationFingerprint(
			"mcp__remote__lookup",
		);
		const serverTransportIdentityFingerprint =
			manager.getToolServerTransportIdentityFingerprint("mcp__remote__lookup");
		if (!declarationFingerprint || !serverTransportIdentityFingerprint) {
			throw new Error("expected MCP prompt declaration snapshot");
		}
		return { declarationFingerprint, serverTransportIdentityFingerprint };
	} finally {
		await manager.close();
	}
}

function approvalSnapshot(
	queue: ApprovalQueue,
	prompt: PromptSnapshot,
): ApprovalExecutionSnapshot {
	const item = queue.enqueue(
		"mcp__remote__lookup",
		{ query: "deploy" },
		"moderate",
		"reviewed MCP lookup",
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		{
			server: "remote",
			tool: "lookup",
			promptDeclarationFingerprint: prompt.declarationFingerprint,
			serverTransportIdentityFingerprint:
				prompt.serverTransportIdentityFingerprint,
		},
	);
	const selection = queue.getExecutionSnapshot(item.id);
	if (!selection.ok) throw new Error("expected approval execution snapshot");
	return selection.snapshot;
}

describe("MCP approval execution preflight process boundary", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function makeProjectAndQueue(): { projectDir: string; queue: ApprovalQueue } {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-preflight-project-"));
		const queueDir = mkdtempSync(join(tmpdir(), "kota-mcp-preflight-queue-"));
		dirs.push(projectDir, queueDir);
		return { projectDir, queue: new ApprovalQueue(queueDir) };
	}

	it("rejects a changed reviewed stdio transport before it can start", async () => {
		const { projectDir, queue } = makeProjectAndQueue();
		writeMcpConfig(projectDir, {
			remote: stdioServer(mcpServerScript({ description: "Stable lookup" })),
		});
		const prompt = await currentPromptSnapshot(projectDir);
		const markerPath = join(projectDir, "changed-transport-started");
		writeMcpConfig(projectDir, {
			remote: stdioServer(mcpServerScript({
				description: "Stable lookup",
				markerPath,
			})),
		});

		const preflight = await prepareApprovalExecutionBatch(
			[approvalSnapshot(queue, prompt)],
			{ cwd: projectDir },
		);

		expect(preflight).toMatchObject({
			ok: false,
			body: { reason: "mcp_server_transport_changed_since_prompt" },
		});
		expect(existsSync(markerPath)).toBe(false);
	});

	it("does not start a newly added stdio server when declaration drift rejects preflight", async () => {
		const { projectDir, queue } = makeProjectAndQueue();
		const descriptionPath = join(projectDir, "tool-description.txt");
		writeFileSync(descriptionPath, "Reviewed lookup");
		const reviewedServer = stdioServer(mcpServerScript({
			descriptionFile: descriptionPath,
		}));
		writeMcpConfig(projectDir, { remote: reviewedServer });
		const prompt = await currentPromptSnapshot(projectDir);

		writeFileSync(descriptionPath, "Changed lookup");
		const markerPath = join(projectDir, "new-server-started");
		writeMcpConfig(projectDir, {
			remote: reviewedServer,
			unreviewed: stdioServer(mcpServerScript({ markerPath })),
		});

		const preflight = await prepareApprovalExecutionBatch(
			[approvalSnapshot(queue, prompt)],
			{ cwd: projectDir },
		);

		expect(preflight).toMatchObject({
			ok: false,
			body: { reason: "mcp_declaration_changed_since_prompt" },
		});
		expect(existsSync(markerPath)).toBe(false);
	});
});
