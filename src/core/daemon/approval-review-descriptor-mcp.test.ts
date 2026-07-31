import { describe, expect, it } from "vitest";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

const mcpApproval = {
	id: "approval-a",
	kind: "tool_call" as const,
	tool: "mcp__remote__lookup",
	scopeId: "scope-a",
	risk: "dangerous" as const,
	reason: "remote lookup",
	mcpPromptDeclaration: {
		server: "remote",
		tool: "lookup",
		promptDeclarationFingerprint: "a".repeat(64),
		serverTransportIdentityFingerprint: "b".repeat(64),
	},
};

describe("MCP approval review descriptors", () => {
	it("binds declaration and transport identity metadata into the receipt", () => {
		const original = createApprovalReviewDescriptor(mcpApproval, { query: "deploy" });

		expect(original.mcpPromptDeclaration).toEqual(
			mcpApproval.mcpPromptDeclaration,
		);
		for (const changedDeclaration of [
			{ ...mcpApproval.mcpPromptDeclaration, server: "other" },
			{ ...mcpApproval.mcpPromptDeclaration, tool: "other" },
			{
				...mcpApproval.mcpPromptDeclaration,
				promptDeclarationFingerprint: "c".repeat(64),
			},
			{
				...mcpApproval.mcpPromptDeclaration,
				serverTransportIdentityFingerprint: "d".repeat(64),
			},
		]) {
			expect(createApprovalReviewDescriptor(
				{ ...mcpApproval, mcpPromptDeclaration: changedDeclaration },
				{ query: "deploy" },
			).digest).not.toBe(original.digest);
		}
	});
});
