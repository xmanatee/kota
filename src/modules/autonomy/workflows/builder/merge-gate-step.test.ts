import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentHarness,
	clearAgentHarnessRegistryForTest,
	registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
	registerWorkflowDefinition,
	validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { createMergeGateStep } from "./merge-gate-step.js";

afterEach(() => {
	clearAgentHarnessRegistryForTest();
});

describe("createMergeGateStep", () => {
	it("validates its declared merge-resolver contract before dispatch", () => {
		const harness: AgentHarness = {
			name: "merge-gate-contract-fixture",
			description: "merge gate contract fixture",
			supportsMultiTurn: true,
			supportedHookKinds: [],
			askOwnerToolName: null,
			emitsAgentMessageStream: false,
			toolControl: "kota",
			unsupportedRunOptions: [{
				runOption: "allowedTools",
				option: "allowedTools",
				reason: "The fixture cannot honor a bounded merge-resolver allowlist.",
			}],
			run: async () => ({
				text: "unused",
				streamedText: "",
				turns: 1,
				isError: false,
			}),
		};
		registerAgentHarness(harness);
		const definition = registerWorkflowDefinition(
			"src/modules/autonomy/workflows/builder/merge-gate-step.ts",
			{
				name: "merge-gate-contract-fixture",
				moduleRoot: process.cwd(),
				triggers: [{ event: "manual" }],
				steps: [createMergeGateStep()],
			},
		);

		expect(() => validateWorkflowDefinitions(
			[definition],
			process.cwd(),
			{ defaultAgentHarness: harness.name },
		)).toThrow(
			/merge-gate-contract-fixture.*steps\[0\].*merge-gate-contract-fixture.*allowedTools.*cannot honor a bounded merge-resolver allowlist/,
		);
	});
});
