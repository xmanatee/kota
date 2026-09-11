import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { AgentTokenBudgetLedger } from "#core/agent-harness/token-budget.js";
import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DaemonRuntimeScopeProvider } from "#core/daemon/runtime-scope-provider.js";
import type { ToolFilesystemTargetResolver } from "#core/tools/filesystem-targets.js";
import type { ToolEffect } from "./effect.js";
import {
	deregisterLocalToolApprovalBinding,
	registerLocalToolApprovalBinding,
} from "./local-tool-approval-binding.js";
import { assertToolStructuredOutput } from "./output-schema.js";
import * as toolEffectRegistry from "./tool-effect-registry.js";
import {
	deregisterToolsFromGroups,
	registerCustomGroup,
	runEnableTools,
} from "./tool-groups.js";
import { assertNotMcpManagedToolName } from "./tool-name-policy.js";
import type { ToolResult, ToolResultBlock } from "./tool-result.js";

export type { ToolResult, ToolResultBlock };
export type ToolRunnerContext = {
	approvalQueue?: ApprovalQueue;
	sessionId?: string;
	toolUseId?: string;
	signal?: AbortSignal;
	/** Canonical directory root of the selected directory-backed scope. */
	scopeRoot?: string;
	/** Live host ownership; an unavailable scope must never fall back to disk. */
	resolveRuntimeScope?: DaemonRuntimeScopeProvider["resolve"];
	/** Execution working directory, which may be an isolated worktree. */
	cwd?: string;
	/** Exact filesystem roots declared for this agent invocation. */
	agentWriteScope?: AgentWriteScope;
	/** Runtime-owned output directory granted in addition to agentWriteScope. */
	agentOutputDir?: string;
	env?: Record<string, string>;
	/** Machine-owned config document that arbitrary execution must not mutate. */
	authorityConfigPath?: string;
	scopeId?: string;
	tokenBudget?: AgentTokenBudgetLedger;
	workflow?: {
		workflowName: string;
		runId: string;
		stepId: string;
		spanId: string;
		scopeId: string;
	};
};
export type ToolRunner = (
	input: Record<string, unknown>,
	context?: ToolRunnerContext,
) => Promise<ToolResult>;
export type ResolvedToolSet = {
	tools: KotaTool[];
	runners: { [name: string]: ToolRunner };
};
/** Co-located tool metadata. Each tool file exports one of these. */
export type ToolRegistration = {
	tool: KotaTool;
	runner: ToolRunner;
	/**
	 * First-class effect descriptor. Drives guardrail classification, MCP
	 * annotations, and autonomy-mode posture. See `./effect.ts`.
	 */
	effect: ToolEffect;
	/** Invocation-specific effect escalation for tools that expose multiple operations. */
	resolveEffect?: toolEffectRegistry.ToolEffectResolver;
  /** Complete filesystem mutation targets; omission leaves local writes unknown. */
  resolveFilesystemTargets?: ToolFilesystemTargetResolver;
	/** Tool group for progressive disclosure. Undefined = core (always available). */
	group?: string;
};

const runners = new Map<string, { runner: ToolRunner }>();
const tools: KotaTool[] = [];
let coreRegistrations: readonly ToolRegistration[] = [];

/** The tool composition root installs core declarations once, before serving calls. */
export function installCoreTools(
	registrations: readonly ToolRegistration[],
): void {
	if (coreRegistrations.length) throw new Error("Core tools already installed");
	coreRegistrations = registrations;
	toolEffectRegistry.setCoreToolEffects(registrations);
	runners.set("enable_tools", { runner: runEnableTools });
	for (const reg of registrations) {
		runners.set(reg.tool.name, { runner: reg.runner });
		tools.push(reg.tool);
		registerLocalToolApprovalBinding(reg.tool, reg.runner, reg);
		if (reg.group) registerCustomGroup(reg.group, [reg.tool.name]);
	}
}
export function getCoreRegistrations(): readonly ToolRegistration[] {
	return coreRegistrations;
}
export function getToolEffect(
	name: string,
	input?: Parameters<ToolRunner>[0],
): ToolEffect | undefined {
	return toolEffectRegistry.resolveRegisteredToolEffect(name, input);
}

/** Returns the full tool list (core + module-registered). Read-only. */
export function getAllTools(): readonly KotaTool[] {
	return tools;
}

export async function executeTool(
	name: string,
	input: Record<string, unknown>,
	context?: ToolRunnerContext,
): Promise<ToolResult> {
	const runner = runners.get(name)?.runner;
	if (!runner) {
		return { content: `Unknown tool: ${name}`, is_error: true };
	}
	try {
		const result = await runner(input, context);
		const tool = tools.find((t) => t.name === name);
		if (tool) assertToolStructuredOutput(tool, result);
		return result;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: `Tool error: ${msg}`, is_error: true };
	}
}

// --- Custom tool registry for extensibility ---

const customToolNames = new Set<string>();
export function registerTool(
	tool: KotaTool,
	runner: ToolRunner,
	moduleName?: string,
	meta?: toolEffectRegistry.ToolEffectMetadata,
): () => void {
	assertNotMcpManagedToolName(tool.name);
	if (runners.has(tool.name)) {
		throw new Error(`Tool already registered: ${tool.name}`);
	}
	tools.push(tool);
	const registration = { runner };
	runners.set(tool.name, registration);
	customToolNames.add(tool.name);
	if (meta) {
		toolEffectRegistry.setModuleToolEffect(tool.name, {
			...meta,
			...(moduleName ? { moduleName } : {}),
		});
	}
	registerLocalToolApprovalBinding(tool, runner, meta);

	return () => {
		if (runners.get(tool.name) === registration) deregisterTool(tool.name);
	};
}

/** Remove a single tool by name. Returns true if found and removed. */
export function deregisterTool(name: string): boolean {
	const idx = tools.findIndex((t) => t.name === name);
	if (idx < 0) return false;
	tools.splice(idx, 1);
	runners.delete(name);
	deregisterLocalToolApprovalBinding(name);
	customToolNames.delete(name);
	deregisterToolsFromGroups(new Set([name]));
	toolEffectRegistry.deleteModuleToolEffect(name);
	return true;
}

export function getRegisteredTools(): KotaTool[] {
	return tools.filter((t) => customToolNames.has(t.name));
}

/**
* Resolve a subset of registered tools by name.
* Returns matching tool definitions and runners; silently skips unknown names.
* Preserve definition and runner identity for authorization of registered operations.
*/
export function resolveToolSet(names: readonly string[]): ResolvedToolSet {
	const resolvedTools: KotaTool[] = [];
	const resolvedRunners: { [name: string]: ToolRunner } = {};
	for (const name of names) {
		const tool = tools.find((t) => t.name === name);
		const runner = runners.get(name)?.runner;
		if (tool && runner) {
			resolvedTools.push(tool);
			resolvedRunners[name] = runner;
		}
	}
	return { tools: resolvedTools, runners: resolvedRunners };
}

/**
* Resolve module-registered tools by their declared effect metadata.
* This keeps mode-specific capability selection tied to the owning tool
* registrations instead of to a second hand-maintained tool-name catalog.
*/
export function resolveRegisteredToolSetByEffect(
	include: (effect: ToolEffect, tool: KotaTool) => boolean,
): ResolvedToolSet {
	const resolvedTools: KotaTool[] = [];
	const resolvedRunners: { [name: string]: ToolRunner } = {};
	for (const tool of tools) {
		if (!customToolNames.has(tool.name)) continue;
		const meta = toolEffectRegistry.getModuleToolEffectMetadata(tool.name);
		const runner = runners.get(tool.name)?.runner;
		if (!meta || !runner || !include(meta.effect, tool)) continue;
		resolvedTools.push(tool);
		resolvedRunners[tool.name] = runner;
	}
	return { tools: resolvedTools, runners: resolvedRunners };
}

export function clearCustomTools(): void {
	for (const name of customToolNames) {
		const idx = tools.findIndex((t) => t.name === name);
		if (idx >= 0) tools.splice(idx, 1);
		runners.delete(name);
		deregisterLocalToolApprovalBinding(name);
	}
	customToolNames.clear();
	toolEffectRegistry.clearModuleToolEffects();
}
