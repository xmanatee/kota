import { describe, expect, it } from "vitest";
import { decodeMrtrRetryParams, readElicitationInputResponse } from "./mcp-mrtr.js";
import {
	activeClientSupportsElicitation,
	decodeClientElicitationCapabilities,
	type HandlerContext,
	MCP_DRAFT_PROTOCOL_VERSION,
	type McpClientCapabilities,
	type McpElicitationInputRequest,
	type McpInputRequests,
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
		}),
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
});
