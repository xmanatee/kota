import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
	KotaJsonValue,
	KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { ApprovalLocalToolDeclaration } from "#core/daemon/approval-queue.js";
import type { ToolEffect } from "./effect.js";
import {
	resolveFilesystemTargets,
	type ToolFilesystemTargets,
} from "./filesystem-targets.js";
import type { ToolRunner, ToolRunnerContext } from "./index.js";
import { assertToolStructuredOutput } from "./output-schema.js";
import { snapshotToolCallForExecution } from "./tool-approval-execution.js";
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
	effect?: ToolEffect;
	targets: ToolFilesystemTargets;
	matches(
		input: Parameters<ToolRunner>[0],
		context?: ToolRunnerContext,
	): boolean;
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

const FINGERPRINT_VERSION = "local-tool-approval-v3";
const registrations = new Map<string, LocalToolRegistration>();
let nextRegistrationGeneration = 0;
const resolverIdentities = new WeakMap<object, number>();
let nextResolverIdentity = 0;
function resolverIdentity(resolver: object | undefined): number | null {
	if (!resolver) return null;
	let identity = resolverIdentities.get(resolver);
	if (identity === undefined) {
		identity = ++nextResolverIdentity;
		resolverIdentities.set(resolver, identity);
	}
	return identity;
}

function stableStringifyJson(value: KotaJsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringifyJson).join(",")}]`;
	}
	return `{${Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${stableStringifyJson(value[key] ?? null)}`,
		)
		.join(",")}}`;
}

function clonedJson(value: object): KotaJsonValue {
	return JSON.parse(JSON.stringify(value)) as KotaJsonValue;
}

function resolvedEffect(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
): ToolEffect | undefined {
	// An unresolved invocation is not the static discovery effect. Preserve the
	// registry's fail-closed result for both approval review and execution.
	return registration.metadata?.resolveEffect
		? registration.metadata.resolveEffect(input)
		: registration.metadata?.effect;
}

function resolveOperation(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
	context?: ToolRunnerContext,
) {
	return {
		// Opaque operations still depend on execution roots even when their
		// destinations cannot be enumerated. Bind defaults at observation time.
		executionRoots: {
			cwd: resolve(context?.cwd ?? process.cwd()),
			scopeRoot: context?.scopeRoot === undefined ? null : resolve(context.scopeRoot),
		},
		effect: resolvedEffect(registration, input),
		targets: resolveFilesystemTargets(
			registration.metadata?.resolveFilesystemTargets,
			input,
			context,
		),
	};
}

function declarationEffectFingerprint(
	registration: LocalToolRegistration,
	input: Parameters<ToolRunner>[0],
	operation: ReturnType<typeof resolveOperation>,
): string {
	const { effect, targets, executionRoots } = operation;
	const material: KotaJsonValue = {
		version: FINGERPRINT_VERSION,
		tool: clonedJson(registration.tool),
    staticEffect: registration.metadata ? clonedJson(registration.metadata.effect) : null,
    manifestEffect: registration.metadata?.manifestEffect ? clonedJson(registration.metadata.manifestEffect) : null,
		input: clonedJson(input),
		executionRoots,
		targets: clonedJson(targets),
		targetResolver: resolverIdentity(
			registration.metadata?.resolveFilesystemTargets,
		),
		effectResolver: resolverIdentity(registration.metadata?.resolveEffect),
		effect:
			effect === undefined
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
	context?: ToolRunnerContext,
	operation = resolveOperation(registration, input, context),
): ApprovalLocalToolDeclaration {
	return {
		executionRoots: { ...operation.executionRoots },
		registrationGeneration: registration.generation,
		declarationEffectFingerprint: declarationEffectFingerprint(
			registration,
			input,
			operation,
		),
	};
}

function declarationsMatch(
	left: ApprovalLocalToolDeclaration,
	right: ApprovalLocalToolDeclaration,
): boolean {
	return (
		left.registrationGeneration === right.registrationGeneration &&
		left.declarationEffectFingerprint === right.declarationEffectFingerprint
	);
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
	context?: ToolRunnerContext,
): ApprovalLocalToolDeclaration | undefined {
	const registration = registrations.get(name);
	return registration === undefined
		? undefined
		: declarationFor(registration, input, context);
}

export function leaseLocalToolForApproval(
	name: string,
	input: Parameters<ToolRunner>[0],
	expected: ApprovalLocalToolDeclaration,
	context?: ToolRunnerContext,
): LocalToolExecutionLeaseResult {
	const registration = registrations.get(name);
	if (registration === undefined) {
		return { ok: false, reason: "tool_unavailable" };
	}
	const snapshot = {
		...registration,
		tool: structuredClone(registration.tool),
		...(registration.metadata
			? {
					metadata: {
						...registration.metadata,
						effect: structuredClone(registration.metadata.effect),
					},
				}
			: {}),
	};
	const operation = resolveOperation(snapshot, input, context);
	const currentDeclaration = declarationFor(
		snapshot,
		input,
		context,
		operation,
	);
	if (
		currentDeclaration.registrationGeneration !==
		expected.registrationGeneration
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
			effect: operation.effect,
			targets: operation.targets,
			matches: (nextInput, nextContext) =>
				declarationsMatch(
					currentDeclaration,
					declarationFor(snapshot, nextInput, nextContext),
				),
		},
	};
}

/** Lease only the registered operation, including when a nested loop supplies runners. */
export function leaseLocalToolForExecution(
	name: string,
	input: Parameters<ToolRunner>[0],
	context?: ToolRunnerContext,
	supplied?: { tool: KotaTool; runner: ToolRunner },
): LocalToolExecutionLeaseResult {
	const registration = registrations.get(name);
	if (!registration) return { ok: false, reason: "tool_unavailable" };
	if (
		supplied &&
		(supplied.runner !== registration.runner ||
			supplied.tool !== registration.tool)
	) {
		return { ok: false, reason: "registration_changed" };
	}
	return leaseLocalToolForApproval(
		name,
		input,
		declarationFor(registration, input, context),
		context,
	);
}

export async function executeLocalToolLease(
	lease: LocalToolExecutionLease,
	input: Parameters<ToolRunner>[0],
	context?: ToolRunnerContext,
): Promise<ToolResult> {
	try {
		const executionInput = snapshotToolCallForExecution({
			name: lease.tool.name,
			input,
		}).input;
		if (!lease.matches(executionInput, context)) {
			return {
				content:
					"Blocked because tool operation targets or inputs changed after authorization.",
				is_error: true,
			};
		}
		const result = await lease.runner(executionInput, context);
		assertToolStructuredOutput(lease.tool, result);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: `Tool error: ${message}`, is_error: true };
	}
}
