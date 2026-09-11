import { classifyRisk } from "./guardrails-classify.js";
import {
	type Assessment,
	type GuardrailsConfig,
	getDefaultConfig,
	resolvePolicy,
} from "./guardrails-config.js";

export { classifyRisk } from "./guardrails-classify.js";
export * from "./guardrails-config.js";

/** Assess a tool call: classify risk and resolve policy. */
export function assess(
	name: string,
	input: Record<string, unknown>,
	config?: GuardrailsConfig,
): Assessment {
	const effectiveConfig = config ?? getDefaultConfig();
	const { risk, reason } = classifyRisk(name, input);
	const policy = resolvePolicy(name, risk, effectiveConfig);
	return { tool: name, risk, policy, reason };
}
