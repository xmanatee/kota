import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { localWriteEffect } from "#core/tools/effect.js";
import {
	clearCustomTools,
	registerTool,
	type ToolRunner,
} from "#core/tools/index.js";

const TOOL_NAMES = ["shell", "git", "filesystem_write"] as const;

function testTool(name: string): KotaTool {
	return {
		name,
		description: `Approval execution test tool: ${name}`,
		input_schema: { type: "object", properties: {} },
	};
}

export function registerApprovalExecutionTestTools(runner: ToolRunner): void {
	for (const name of TOOL_NAMES) {
		registerTool(
			testTool(name),
			runner,
			undefined,
			{ effect: localWriteEffect() },
		);
	}
}

export function clearApprovalExecutionTestTools(): void {
	clearCustomTools();
}
