import { beforeEach, vi } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import type {
	KotaContentBlock,
	KotaJsonObject,
	KotaMessage,
	KotaModelResponse,
	KotaTool,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { ApprovalQueue, PendingApproval } from "#core/daemon/approval-queue.js";
import type {
	MessageStreamParams,
	ProviderFactoryOptions,
	ResolvedProvider,
} from "#core/model/model-client.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type {
	ToolResult,
	ToolRunner,
	ToolRunnerContext,
} from "#core/tools/index.js";

type StubStream = {
	on(event: "text" | "thinking", cb: (delta: string) => void): StubStream;
	finalMessage(): Promise<KotaModelResponse>;
};

type StreamCallSnapshot = {
	tools: readonly KotaTool[] | undefined;
	messages: KotaMessage[];
};

type EnqueueApproval = ApprovalQueue["enqueue"];

const messagesStreamMock = vi.hoisted(() =>
	vi.fn<(params: MessageStreamParams) => StubStream>(),
);
const createModelClientMock = vi.hoisted(() =>
	vi.fn<(opts: ProviderFactoryOptions) => ResolvedProvider>(),
);
const executeToolMock = vi.hoisted(() =>
	vi.fn<
		(
			name: string,
			input: Parameters<ToolRunner>[0],
			context?: ToolRunnerContext,
		) => Promise<ToolResult>
	>(),
);
const getAllToolsMock = vi.hoisted(() =>
	vi.fn<() => readonly KotaTool[]>(),
);
const getToolEffectMock = vi.hoisted(() =>
	vi.fn<(name: string) => ToolEffect | undefined>(),
);
const confirmActionMock = vi.hoisted(() =>
	vi.fn<(message: string) => Promise<boolean>>(),
);
const enqueueApprovalMock = vi.hoisted(() => vi.fn<EnqueueApproval>());

export const approvalQueueMock = {
	enqueue: (...args: Parameters<EnqueueApproval>) => enqueueApprovalMock(...args),
} as ApprovalQueue;

export {
	confirmActionMock,
	createModelClientMock,
	enqueueApprovalMock,
	executeToolMock,
	getAllToolsMock,
	getToolEffectMock,
	messagesStreamMock,
};

vi.mock("#core/model/model-client.js", () => ({
	createModelClient: (opts: ProviderFactoryOptions) => createModelClientMock(opts),
}));

vi.mock("#core/tools/index.js", () => ({
	executeTool: (
		name: string,
		input: Parameters<ToolRunner>[0],
		context?: ToolRunnerContext,
	) => executeToolMock(name, input, context),
	getAllTools: () => getAllToolsMock(),
	getToolEffect: (name: string) => getToolEffectMock(name),
}));

vi.mock("#core/config/secrets.js", () => ({
	maskKnownSecretValues: (text: string) => text,
}));

vi.mock("#core/util/confirm.js", () => ({
	confirmAction: (message: string) => confirmActionMock(message),
}));

vi.mock("#core/daemon/approval-queue.js", () => ({
	getApprovalQueue: () => ({
		enqueue: (...args: Parameters<EnqueueApproval>) => enqueueApprovalMock(...args),
	}),
}));

export let openaiToolsAgentHarness: AgentHarness;

export const READ_EFFECT: ToolEffect = {
	kind: "read",
	scope: "local-fs",
	idempotent: true,
	openWorld: false,
};
export const WRITE_EFFECT: ToolEffect = {
	kind: "write",
	scope: "local-fs",
	idempotent: false,
	openWorld: false,
};

export const streamCallSnapshots: StreamCallSnapshot[] = [];
export const streamReturnQueue: StubStream[] = [];

function pendingApprovalFromCall(
	id: string,
	args: Parameters<EnqueueApproval>,
): PendingApproval {
	const [
		tool,
		input,
		risk,
		reason,
		source,
		timeoutMs,
		defaultResolution,
		context,
		sessionId,
		mcpPromptDeclaration,
	] = args;
	const item: PendingApproval = {
		id,
		scopeId: "scope-test",
		tool,
		input,
		risk,
		reason,
		...(source !== undefined ? { source } : {}),
		...(sessionId !== undefined ? { sessionId } : {}),
		...(context !== undefined ? { context } : {}),
		...(mcpPromptDeclaration !== undefined ? { mcpPromptDeclaration } : {}),
		createdAt: "2026-06-26T00:00:00.000Z",
		status: "pending",
		...(timeoutMs !== undefined ? { timeoutMs } : {}),
		...(defaultResolution !== undefined ? { defaultResolution } : {}),
	};
	return item;
}

export function makeStubStream(
	final: Pick<KotaModelResponse, "id" | "content" | "stop_reason">,
): StubStream {
	const stream: StubStream = {
		on() {
			return stream;
		},
		finalMessage: async (): Promise<KotaModelResponse> => ({
			id: final.id,
			role: "assistant",
			model: "stub-model",
			content: final.content,
			stop_reason: final.stop_reason,
			stop_sequence: null,
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_creation_input_tokens: null,
				cache_read_input_tokens: null,
			},
		}),
	};
	return stream;
}

export function queueToolUse(id: string, name: string, input: KotaJsonObject): void {
	const block: KotaToolUseBlock = { type: "tool_use", id, name, input };
	streamReturnQueue.push(
		makeStubStream({
			id: `msg_${id}`,
			stop_reason: "tool_use",
			content: [block],
		}),
	);
}

export function queueToolUseBlocks(
	id: string,
	blocks: readonly KotaToolUseBlock[],
): void {
	streamReturnQueue.push(
		makeStubStream({
			id,
			stop_reason: "tool_use",
			content: [...blocks],
		}),
	);
}

export function queueEnd(text = "done"): void {
	streamReturnQueue.push(
		makeStubStream({
			id: "msg_end",
			stop_reason: "end_turn",
			content: [{ type: "text", text, citations: null } as KotaContentBlock],
		}),
	);
}

export function tool(name: string): KotaTool {
	return {
		name,
		description: name,
		input_schema: { type: "object", properties: {} },
	};
}

export function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

export function mcpFixtureServer(): string {
	return `
const rl = require("readline").createInterface({ input: process.stdin });
function write(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "openai-tools-mcp-fixture" } } });
  } else if (msg.method === "tools/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "lookup", description: "Looks up remote content", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] } });
  } else if (msg.method === "tools/call" && msg.params.name === "lookup") {
    write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "remote content" }] } });
  } else if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.id !== undefined) {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;
}

beforeEach(async () => {
	vi.clearAllMocks();
	streamCallSnapshots.length = 0;
	streamReturnQueue.length = 0;
	getAllToolsMock.mockReturnValue([]);
	getToolEffectMock.mockReturnValue(READ_EFFECT);
	confirmActionMock.mockResolvedValue(true);
	enqueueApprovalMock.mockImplementation((...args) =>
		pendingApprovalFromCall("approval-openai-tools", args),
	);
	messagesStreamMock.mockImplementation((params) => {
		streamCallSnapshots.push({
			tools: params.tools ? [...params.tools] : undefined,
			messages: JSON.parse(JSON.stringify(params.messages)) as KotaMessage[],
		});
		const next = streamReturnQueue.shift();
		if (!next) throw new Error("messagesStreamMock: no scripted return value");
		return next;
	});
	createModelClientMock.mockImplementation(({ model }) => ({
		client: { messages: { create: vi.fn(), stream: messagesStreamMock } },
		model,
		providerName: "openai",
	}));
	const adapter = await import("./adapter.js");
	openaiToolsAgentHarness = adapter.openaiToolsAgentHarness;
});
