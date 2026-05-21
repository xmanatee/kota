import { describe, expect, it } from "vitest";
import { decodeMrtrRetryParams, readElicitationInputResponse } from "./mcp-mrtr.js";
import {
	activeClientSupportsElicitation,
	decodeClientElicitationCapabilities,
	type HandlerContext,
	isMcpTaskTerminalStatus,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_TASK_STATUSES,
	MCP_TASK_TERMINAL_STATUSES,
	type McpClientCapabilities,
	type McpCreateTaskResult,
	type McpElicitationInputRequest,
	type McpInputRequests,
	type McpStoredTaskTerminalResult,
	type McpTaskListPage,
	type McpTaskResultSettlement,
} from "./mcp-protocol-types.js";

function ctxWithClientCapabilities(clientCapabilities: McpClientCapabilities): HandlerContext {
	return {
		transport: {
			send: () => {},
			sendResult: () => {},
			sendError: () => {},
			sendNotification: () => {},
		},
		log: () => {},
		session: {
			initialized: true,
			protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			clientElicitation: { form: false, url: false },
			clientSupportsRoots: false,
		},
		getRequestContext: () => ({
			protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			clientInfo: { name: "test", version: "1.0.0" },
			clientCapabilities,
			requestId: 1,
		}),
		sendProgress: () => {},
	};
}

describe("MCP elicitation capability modes", () => {
	it("treats legacy empty elicitation capabilities as form-only", () => {
		expect(decodeClientElicitationCapabilities({ elicitation: {} })).toEqual({
			form: true,
			url: false,
		});
		expect(activeClientSupportsElicitation(
			ctxWithClientCapabilities({ elicitation: {} }),
			"form",
		)).toBe(true);
		expect(activeClientSupportsElicitation(
			ctxWithClientCapabilities({ elicitation: {} }),
			"url",
		)).toBe(false);
	});

	it("distinguishes explicit form and URL elicitation capabilities", () => {
		expect(decodeClientElicitationCapabilities({ elicitation: { form: {} } })).toEqual({
			form: true,
			url: false,
		});
		expect(decodeClientElicitationCapabilities({ elicitation: { url: {} } })).toEqual({
			form: false,
			url: true,
		});
		expect(decodeClientElicitationCapabilities({
			elicitation: { form: {}, url: {} },
		})).toEqual({
			form: true,
			url: true,
		});
	});

	it("keeps URL-mode input requests unsupported for form-only clients", () => {
		const urlRequest: McpElicitationInputRequest = {
			method: "elicitation/create",
			params: {
				mode: "url",
				message: "Please authorize Example Auth.",
				url: "https://auth.example.test/consent?state=abc",
				elicitationId: "oauth-abc",
			},
		};
		const inputRequests: McpInputRequests = { oauth: urlRequest };
		expect(inputRequests.oauth).toEqual(urlRequest);
		expect(activeClientSupportsElicitation(
			ctxWithClientCapabilities({ elicitation: {} }),
			urlRequest.params.mode,
		)).toBe(false);
	});
});

describe("MCP task protocol types", () => {
	it("names the draft task statuses and terminal subset", () => {
		expect([...MCP_TASK_STATUSES]).toEqual([
			"working",
			"input_required",
			"completed",
			"failed",
			"cancelled",
		]);
		expect([...MCP_TASK_TERMINAL_STATUSES]).toEqual([
			"completed",
			"failed",
			"cancelled",
		]);
		expect(isMcpTaskTerminalStatus("working")).toBe(false);
		expect(isMcpTaskTerminalStatus("completed")).toBe(true);
	});

	it("keeps task creation, listing, terminal, and input-required shapes typed", () => {
		const created: McpCreateTaskResult = {
			task: {
				taskId: "task-a",
				status: "working",
				createdAt: "2026-05-21T00:00:00.000Z",
				lastUpdatedAt: "2026-05-21T00:00:00.000Z",
				ttl: 60_000,
				pollInterval: 1_000,
			},
		};
		const page: McpTaskListPage = {
			tasks: [created.task],
			nextCursor: "opaque",
		};
		const terminal: McpStoredTaskTerminalResult = {
			kind: "error",
			error: { code: -32603, message: "Tool failed", data: { retryable: false } },
		};
		const inputRequired: McpTaskResultSettlement = {
			kind: "input_required",
			task: created.task,
			inputRequired: {
				resultType: "input_required",
				requestState: "state-token",
			},
		};

		expect(page.tasks[0]?.taskId).toBe("task-a");
		expect(terminal.kind).toBe("error");
		expect(inputRequired.inputRequired.resultType).toBe("input_required");
	});
});

describe("MRTR elicitation response modes", () => {
	it("allows URL-mode accept responses without form content", () => {
		const decoded = decodeMrtrRetryParams({
			requestState: "state-token",
			inputResponses: {
				oauth: { action: "accept" },
			},
		});

		expect(decoded.kind).toBe("retry");
		if (decoded.kind !== "retry") throw new Error("Expected retry params");
		expect(readElicitationInputResponse(decoded.inputResponses, "oauth", "url")).toEqual({
			action: "accept",
		});
	});

	it("keeps form-mode accept responses content-bearing", () => {
		const decoded = decodeMrtrRetryParams({
			requestState: "state-token",
			inputResponses: {
				confirm: { action: "accept" },
			},
		});

		expect(decoded.kind).toBe("retry");
		if (decoded.kind !== "retry") throw new Error("Expected retry params");
		expect(readElicitationInputResponse(decoded.inputResponses, "confirm", "form")).toBe(
			"inputResponses.confirm.content must be an object when action is accept",
		);
	});

	it("normalizes legacy draft reject retry responses to decline", () => {
		const decoded = decodeMrtrRetryParams({
			requestState: "state-token",
			inputResponses: {
				confirm: { action: "reject" },
			},
		});

		expect(decoded.kind).toBe("retry");
		if (decoded.kind !== "retry") throw new Error("Expected retry params");
		expect(readElicitationInputResponse(decoded.inputResponses, "confirm", "form")).toEqual({
			action: "decline",
		});
	});
});
