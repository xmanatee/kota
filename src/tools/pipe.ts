import type Anthropic from "@anthropic-ai/sdk";
import { evaluateCondition, resolveStepInput } from "../manifest/index.js";
import { executeTool, type ToolResult } from "./index.js";

export const pipeTool: Anthropic.Tool = {
	name: "pipe",
	description:
		"Chain tools sequentially — each step's output feeds the next via $prev. " +
		"Use $steps[N] for any prior output. Replaces multi-turn tool chains with one call.",
	input_schema: {
		type: "object" as const,
		properties: {
			steps: {
				type: "array",
				items: {
					type: "object",
					properties: {
						tool: { type: "string", description: "Tool name to invoke" },
						input: {
							type: "object",
							description:
								"Tool input. String values support $prev, $steps[N], $prev.field, {{template}}.",
						},
						if: {
							type: "string",
							description: "Condition — skip this step when false (uses $prev, $steps[N])",
						},
					},
					required: ["tool"],
				},
				description: "Ordered tool invocations with data flow between steps",
			},
		},
		required: ["steps"],
	},
};

const MAX_STEPS = 10;

type PipeStep = {
	tool: string;
	input?: Record<string, unknown>;
	if?: string;
};

export async function runPipe(input: Record<string, unknown>): Promise<ToolResult> {
	const steps = input.steps as PipeStep[];

	if (!Array.isArray(steps) || steps.length === 0) {
		return { content: "Error: steps array is required and must not be empty", is_error: true };
	}
	if (steps.length > MAX_STEPS) {
		return {
			content: `Error: max ${MAX_STEPS} steps per pipe, got ${steps.length}`,
			is_error: true,
		};
	}

	let prevContent = "";
	const allOutputs: string[] = [];
	const emptyPayload: Record<string, unknown> = {};

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (!step.tool) {
			return { content: `Error: step ${i + 1} missing tool name`, is_error: true };
		}

		if (step.if && !evaluateCondition(step.if, prevContent, emptyPayload, allOutputs)) {
			allOutputs.push("");
			continue;
		}

		const resolved = resolveStepInput(step.input, prevContent, emptyPayload, allOutputs);

		try {
			const result = await executeTool(step.tool, resolved);
			if (result.is_error) {
				return {
					content: `Step ${i + 1}/${steps.length} ("${step.tool}") failed: ${result.content}`,
					is_error: true,
				};
			}
			prevContent = result.content;
			allOutputs.push(result.content);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: `Step ${i + 1}/${steps.length} ("${step.tool}") threw: ${msg}`,
				is_error: true,
			};
		}
	}

	return { content: prevContent };
}

export const registration = {
	tool: pipeTool,
	runner: runPipe,
	risk: "moderate" as const,
	kind: "action" as const,
	group: "orchestration",
};
