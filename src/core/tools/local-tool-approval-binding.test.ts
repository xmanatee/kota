import { afterEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
	localDestructiveEffect,
	localWriteEffect,
} from "./effect.js";
import {
	captureLocalToolApprovalDeclaration,
	deregisterLocalToolApprovalBinding,
	leaseLocalToolForApproval,
	registerLocalToolApprovalBinding,
} from "./local-tool-approval-binding.js";
import type { ToolEffectMetadata } from "./tool-effect-registry.js";

const TOOL_NAME = "local_approval_binding_test";
const tool: KotaTool = {
	name: TOOL_NAME,
	description: "A local approval binding test tool",
	input_schema: {
		type: "object",
		properties: { operation: { type: "string" } },
		required: ["operation"],
	},
};

afterEach(() => {
	deregisterLocalToolApprovalBinding(TOOL_NAME);
	tool.description = "A local approval binding test tool";
});

describe("local tool approval binding", () => {
	it("fingerprints both the declaration and resolved effect metadata", () => {
		const metadata: ToolEffectMetadata = { effect: localWriteEffect() };
		registerLocalToolApprovalBinding(
			tool,
			vi.fn(async () => ({ content: "ok" })),
			metadata,
		);
		const input = { operation: "deploy" };
		const reviewed = captureLocalToolApprovalDeclaration(TOOL_NAME, input);
		if (reviewed === undefined) throw new Error("expected reviewed declaration");

		metadata.effect = localDestructiveEffect();
		expect(leaseLocalToolForApproval(
			TOOL_NAME,
			input,
			reviewed,
		)).toMatchObject({
			ok: false,
			reason: "declaration_effect_changed",
		});

		metadata.effect = localWriteEffect();
		tool.description = "A changed local approval binding test tool";
		expect(leaseLocalToolForApproval(
			TOOL_NAME,
			input,
			reviewed,
		)).toMatchObject({
			ok: false,
			reason: "declaration_effect_changed",
		});
	});
});
