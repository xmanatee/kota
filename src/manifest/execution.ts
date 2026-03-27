/**
 * Manifest execution — converts manifests to KotaExtensions and runs
 * event handlers, step pipelines, and named scripts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "../data/code-wrappers.js";
import { getModuleLogStore } from "../extension-log.js";
import type { KotaExtension, ToolDef } from "../extension-types.js";
import type { Language } from "../repl-session.js";
import { sessions } from "../repl-session.js";
import { executeTool, type ToolResult } from "../tools/index.js";
import { evaluateCondition, resolveStepInput } from "./steps.js";
import type {
	ManifestEventHandler,
	ManifestScriptDef,
	ManifestToolDef,
	ModuleManifest,
} from "./types.js";

// ─── Tool runner builder ─────────────────────────────────────────────

function buildToolRunner(
	toolDef: ManifestToolDef,
): (input: Record<string, unknown>) => Promise<ToolResult> {
	const lang: Language = toolDef.language || "python";
	return async (input) => {
		const paramsJson = JSON.stringify(input);
		const b64 = Buffer.from(paramsJson).toString("base64");

		const wrapper =
			lang === "python"
				? `import json as __j, base64 as __b\nparams = __j.loads(__b.b64decode('${b64}').decode())\n${toolDef.code}`
				: `const params = JSON.parse(Buffer.from('${b64}','base64').toString());\n${toolDef.code}`;

		const session = sessions[lang];
		const { output, isError } = await session.execute(
			wrapper,
			DEFAULT_TIMEOUT,
		);

		const truncated =
			output.length > MAX_OUTPUT
				? `${output.slice(0, MAX_OUTPUT)}\n[truncated — ${output.length} chars total]`
				: output;

		return { content: truncated, is_error: isError };
	};
}

// ─── Manifest → KotaExtension conversion ────────────────────────────────

export function manifestToModule(manifest: ModuleManifest): KotaExtension {
	const tools: ToolDef[] = (manifest.tools || []).map((t) => ({
		tool: {
			name: t.name,
			description: t.description,
			input_schema: (t.parameters || {
				type: "object" as const,
				properties: {},
			}) as Anthropic.Tool["input_schema"],
		},
		runner: buildToolRunner(t),
		group: t.group,
	}));

	const mod: KotaExtension = {
		name: manifest.name,
		version: manifest.version || "1.0.0",
		description: manifest.description,
		dependencies: manifest.dependencies,
		tools: tools.length > 0 ? tools : undefined,
	};

	if (manifest.eventHandlers && manifest.eventHandlers.length > 0) {
		const handlers = manifest.eventHandlers;
		mod.events = (bus) => {
			const unsubs: (() => void)[] = [];
			for (const handler of handlers) {
				if (handler.steps) {
					const unsub = bus.on(handler.event, (payload) => {
						runStepHandler(manifest.name, handler, payload);
					});
					unsubs.push(unsub);
				} else if (handler.code) {
					const unsub = bus.on(handler.event, (payload) => {
						runEventHandler(manifest.name, handler, payload);
					});
					unsubs.push(unsub);
				}
			}
			return unsubs;
		};
	}

	return mod;
}

// ─── Code-based event handler ────────────────────────────────────────

/**
 * Execute a manifest event handler's code in a REPL session.
 * Injects `event_name` and `payload` variables into the code environment.
 * Errors are logged but never propagated — event handlers must not crash the bus.
 */
function runEventHandler(
	moduleName: string,
	handler: ManifestEventHandler,
	payload: Record<string, unknown>,
): void {
	const lang: Language = handler.language || "python";
	const payloadJson = JSON.stringify(payload);
	const b64 = Buffer.from(payloadJson).toString("base64");

	const wrapper =
		lang === "python"
			? `import json as __j, base64 as __b\nevent_name = ${JSON.stringify(handler.event)}\npayload = __j.loads(__b.b64decode('${b64}').decode())\n${handler.code}`
			: `const event_name = ${JSON.stringify(handler.event)};\nconst payload = JSON.parse(Buffer.from('${b64}','base64').toString());\n${handler.code}`;

	const session = sessions[lang];
	session.execute(wrapper, DEFAULT_TIMEOUT).then(
		({ output, isError }) => {
			if (isError) {
				console.error(`[module:${moduleName}] Event handler error (${handler.event}): ${output}`);
				getModuleLogStore()?.append(moduleName, "error", `Event handler (${handler.event}): ${output}`);
			} else if (output.trim()) {
				console.error(`[module:${moduleName}] Event handler (${handler.event}): ${output.trim()}`);
				getModuleLogStore()?.append(moduleName, "info", `Event handler (${handler.event}): ${output.trim()}`);
			}
		},
		(err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[module:${moduleName}] Event handler failed (${handler.event}): ${msg}`);
			getModuleLogStore()?.append(moduleName, "error", `Event handler failed (${handler.event}): ${msg}`);
		},
	);
}

// ─── Step-based event handler ────────────────────────────────────────

/**
 * Execute a step-based event handler — sequential tool invocations.
 * Each step's output feeds into the next via "$prev". Stops on first error.
 * All step outputs are tracked for $steps[N] references.
 */
function runStepHandler(
	moduleName: string,
	handler: ManifestEventHandler,
	payload: Record<string, unknown>,
): void {
	if (!handler.steps || handler.steps.length === 0) return;

	const steps = handler.steps;
	(async () => {
		const logStore = getModuleLogStore();
		logStore?.append(moduleName, "info", `Event handler started (${handler.event}, ${steps.length} steps)`);
		let prevContent = "";
		const allOutputs: string[] = [];
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			if (step.if && !evaluateCondition(step.if, prevContent, payload, allOutputs)) {
				allOutputs.push("");
				logStore?.append(moduleName, "debug", `Step ${i + 1} "${step.tool}" skipped (condition false)`);
				continue;
			}
			const input = resolveStepInput(step.input, prevContent, payload, allOutputs);
			try {
				const result = await executeTool(step.tool, input);
				if (result.is_error) {
					console.error(
						`[module:${moduleName}] Step "${step.tool}" failed: ${result.content}`,
					);
					logStore?.append(moduleName, "error", `Step ${i + 1} "${step.tool}" failed: ${result.content}`);
					return;
				}
				prevContent = result.content;
				allOutputs.push(result.content);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(
					`[module:${moduleName}] Step "${step.tool}" threw: ${msg}`,
				);
				logStore?.append(moduleName, "error", `Step ${i + 1} "${step.tool}" threw: ${msg}`);
				return;
			}
		}
		logStore?.append(moduleName, "info", `Event handler completed (${handler.event}, ${steps.length} steps)`);
	})();
}

// ─── Named script execution ─────────────────────────────────────────

/**
 * Execute a named module script — sequential tool invocations, awaitable.
 * Returns the final step's ToolResult, or an error result if any step fails.
 * `args` is passed as the payload for "$payload" substitution in step inputs.
 * All step outputs are tracked for $steps[N] references.
 */
export async function runModuleScript(
	moduleName: string,
	script: ManifestScriptDef,
	args: Record<string, unknown> = {},
): Promise<ToolResult> {
	const { steps } = script;
	if (!steps || steps.length === 0) {
		return { content: "Script has no steps", is_error: true };
	}

	const logStore = getModuleLogStore();
	logStore?.append(moduleName, "info", `Script started (${steps.length} steps)`);
	let prevContent = "";
	const allOutputs: string[] = [];
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.if && !evaluateCondition(step.if, prevContent, args, allOutputs)) {
			allOutputs.push("");
			logStore?.append(moduleName, "debug", `Script step ${i + 1} "${step.tool}" skipped (condition false)`);
			continue;
		}
		const input = resolveStepInput(step.input, prevContent, args, allOutputs);
		try {
			const result = await executeTool(step.tool, input);
			if (result.is_error) {
				logStore?.append(moduleName, "error", `Script step ${i + 1} "${step.tool}" failed: ${result.content}`);
				return {
					content: `Step ${i + 1}/${steps.length} ("${step.tool}") failed: ${result.content}`,
					is_error: true,
				};
			}
			prevContent = result.content;
			allOutputs.push(result.content);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logStore?.append(moduleName, "error", `Script step ${i + 1} "${step.tool}" threw: ${msg}`);
			return {
				content: `Step ${i + 1}/${steps.length} ("${step.tool}") threw: ${msg}`,
				is_error: true,
			};
		}
	}

	logStore?.append(moduleName, "info", `Script completed (${steps.length} steps)`);
	return { content: prevContent };
}
