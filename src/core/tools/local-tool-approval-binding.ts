import { createHash } from "node:crypto";
import type {
	KotaJsonValue,
	KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { ApprovalLocalToolDeclaration } from "#core/daemon/approval-queue.js";
import type { ToolEffect } from "./effect.js";
import type {
	ToolRunner,
	ToolRunnerContext,
} from "./index.js";
import { assertToolStructuredOutput } from "./output-schema.js";
import type { ToolEffectMetadata } from "./tool-effect-registry.js";
import type { ToolResult } from "./tool-result.js";

type LocalToolRegistration = {
	generation: number;
	tool: KotaTool;
	runner: ToolRunner;
	metadata?: ToolEffectMetadata;
};

export type LocalToolExecutionLease = {
	declaration: ApprovalLocalToolDeclaration;
	tool: KotaTool;
	runner: ToolRunner;
};

export type LocalToolExecutionLeaseResult =
	| { ok: true; lease: LocalToolExecutionLease }
	| {
		ok: false;
		reason:
			| "tool_unavailable"
			| "registration_changed"
			| "declaration_effect_changed";
		currentDeclaration?: ApprovalLocalToolDeclaration;
	  };

const FINGERPRINT_VERSION = "local-tool-approval-v1";
const registrations = new Map<string, LocalToolRegistration>();
let nextRegistrationGeneration = 0;

function stableStringifyJson(value: KotaJsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringifyJson).join(",")}]`;
	}
	return `{${Object.keys(value)
		.sort()
		.map((key) =>
			`${JSON.stringify(key)}:${stableStringifyJson(value[key] ?? null)}`)
		.join(",")}}`;
}

function clonedJson(value: object): KotaJsonValue {
	return JSON.parse(JSON.stringify(value)) as KotaJsonValue;
}

function resolvedEffect(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
): ToolEffect | undefined {
	return registration.metadata?.resolveEffect?.(input)
		?? registration.metadata?.effect;
}

function declarationEffectFingerprint(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
): string {
	const effect = resolvedEffect(registration, input);
	const material: KotaJsonValue = {
		version: FINGERPRINT_VERSION,
		tool: clonedJson(registration.tool),
		effect: effect === undefined
			? { state: "missing" }
			: { state: "present", value: clonedJson(effect) },
	};
	return createHash("sha256")
		.update(stableStringifyJson(material))
		.digest("hex");
}

function declarationFor(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
): ApprovalLocalToolDeclaration {
	return {
		registrationGeneration: registration.generation,
		declarationEffectFingerprint:
			declarationEffectFingerprint(registration, input),
	};
}

function declarationsMatch(
	left: ApprovalLocalToolDeclaration,
	right: ApprovalLocalToolDeclaration,
): boolean {
	return left.registrationGeneration === right.registrationGeneration
		&& left.declarationEffectFingerprint
			=== right.declarationEffectFingerprint;
}

export function registerLocalToolApprovalBinding(
	tool: KotaTool,
	runner: ToolRunner,
	metadata?: ToolEffectMetadata,
): void {
	nextRegistrationGeneration += 1;
	if (!Number.isSafeInteger(nextRegistrationGeneration)) {
		throw new Error("Local tool registration generation exhausted");
	}
	registrations.set(tool.name, {
		generation: nextRegistrationGeneration,
		tool,
		runner,
		...(metadata !== undefined ? { metadata } : {}),
	});
}

export function deregisterLocalToolApprovalBinding(name: string): void {
	registrations.delete(name);
}

export function captureLocalToolApprovalDeclaration(
	name: string,
	input: Parameters<ToolRunner>[0],
): ApprovalLocalToolDeclaration | undefined {
	const registration = registrations.get(name);
	return registration === undefined
		? undefined
		: declarationFor(registration, input);
}

export function leaseLocalToolForApproval(
	name: string,
	input: Parameters<ToolRunner>[0],
	expected: ApprovalLocalToolDeclaration,
): LocalToolExecutionLeaseResult {
	const registration = registrations.get(name);
	if (registration === undefined) {
		return { ok: false, reason: "tool_unavailable" };
	}
	const currentDeclaration = declarationFor(registration, input);
	if (
		currentDeclaration.registrationGeneration
		!== expected.registrationGeneration
	) {
		return {
			ok: false,
			reason: "registration_changed",
			currentDeclaration,
		};
	}
	if (!declarationsMatch(currentDeclaration, expected)) {
		return {
			ok: false,
			reason: "declaration_effect_changed",
			currentDeclaration,
		};
	}
	return {
		ok: true,
		lease: {
			declaration: currentDeclaration,
			tool: structuredClone(registration.tool),
			runner: registration.runner,
		},
	};
}

export async function executeLocalToolLease(
	lease: LocalToolExecutionLease,
	input: Parameters<ToolRunner>[0],
	context?: ToolRunnerContext,
): Promise<ToolResult> {
	try {
		const result = await lease.runner(input, context);
		assertToolStructuredOutput(lease.tool, result);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: `Tool error: ${message}`, is_error: true };
	}
}
