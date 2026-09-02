import { type Dirent, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import {
	type AgentUsage,
	AgentUsageAccumulator,
	parseAgentUsage,
	pricedAgentUsage,
	UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/usage.js";
import { JsonFileError, readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "./run-io.js";
import type { DurableRunState } from "./run-state-types.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "./run-types.js";

export const WORKFLOW_RUN_METADATA_VERSION = 1 as const;
const MAX_ENUMERATION_WARNINGS = 20;

export function isWorkflowRunMetadataAuthorityCriticalState(
	state: DurableRunState,
): boolean {
	return (
		state === "running" ||
		state === "waiting" ||
		state === "integrating" ||
		state === "needs_attention"
	);
}

export function workflowRunMetadataAuthorityCriticalIds(
	runs: readonly Readonly<{ id: string; state: DurableRunState }>[],
	pendingPublications: readonly Readonly<{ runId: string }>[] = [],
): ReadonlySet<string> {
	const ids = new Set(
		runs
			.filter((run) => isWorkflowRunMetadataAuthorityCriticalState(run.state))
			.map((run) => run.id),
	);
	for (const publication of pendingPublications) ids.add(publication.runId);
	return ids;
}

export function workflowRunMetadataOperationallyActiveIds(
	runs: readonly Readonly<{ id: string; state: DurableRunState }>[],
): ReadonlySet<string> {
	return new Set(
		runs
			.filter((run) => isWorkflowRunMetadataAuthorityCriticalState(run.state))
			.map((run) => run.id),
	);
}

export function workflowRunMetadataTerminalIds(
	runs: readonly Readonly<{ id: string; state: DurableRunState }>[],
): ReadonlySet<string> {
	return new Set(
		runs
			.filter((run) =>
				run.state === "succeeded" ||
				run.state === "failed" ||
				run.state === "cancelled"
			)
			.map((run) => run.id),
	);
}

export type VersionedWorkflowRunMetadata = WorkflowRunMetadata &
	Readonly<{
		metadataVersion: typeof WORKFLOW_RUN_METADATA_VERSION;
	}>;

declare const storedWorkflowRunDirectoryId: unique symbol;

export type StoredWorkflowRunDirectoryId = string & {
	readonly [storedWorkflowRunDirectoryId]: "stored-workflow-run-directory-id";
};

/** Metadata whose id is path-safe and matches its persisted parent directory. */
export type StoredWorkflowRunMetadata = Omit<
	VersionedWorkflowRunMetadata,
	"id"
> &
	Readonly<{ id: StoredWorkflowRunDirectoryId }>;

const duration = z.number().finite().nonnegative();
const timestamp = z.iso.datetime({
	offset: true,
	error: "must be an ISO 8601 timestamp",
});
const tokenUsage = z.unknown().transform((raw, context): AgentUsage => {
	try {
		return parseAgentUsage(raw, "usage");
	} catch (error) {
		context.addIssue({
			code: "custom",
			message: error instanceof Error ? error.message : String(error),
		});
		return z.NEVER;
	}
});

const toolCall = z.strictObject({
	tool: z.string(),
	count: z.number().int().nonnegative(),
	totalMs: duration,
});

const trajectoryDiagnostics = z.strictObject({
	artifactPath: z.string(),
	warningCount: z.number().int().nonnegative(),
	unsupportedTrajectoryCount: z.number().int().nonnegative(),
	missingStreamingFramesCount: z.number().int().nonnegative(),
	missingFinalVerificationAfterEditCount: z.number().int().nonnegative(),
	repeatedIdenticalFailingCommandCount: z.number().int().nonnegative(),
	editAfterSuccessfulVerificationCount: z.number().int().nonnegative(),
	longPreambleWithoutTaskTouchCount: z.number().int().nonnegative(),
});

const stepType = z.enum([
	"tool",
	"agent",
	"emit",
	"restart",
	"code",
	"trigger",
	"parallel",
	"branch",
	"foreach",
	"approval",
	"await-event",
]);

const nonAgentStepType = z.enum([
	"tool",
	"emit",
	"restart",
	"code",
	"trigger",
	"parallel",
	"branch",
	"foreach",
	"approval",
	"await-event",
]);

const errorKind = z.enum([
	"idle-timeout",
	"step-timeout",
	"repair-no-progress",
	"repair-attempts-exhausted",
	"rate_limit",
	"auth",
	"provider",
	"runtime",
]);

const commonStep = {
	id: z.string(),
	startedAt: timestamp,
	completedAt: timestamp,
	durationMs: duration,
	activeDurationMs: duration.optional(),
	hostSuspendedMs: duration.optional(),
	output: z.unknown().optional(),
	error: z.string().optional(),
	errorKind: errorKind.optional(),
	idleTimeoutMs: duration.optional(),
	continueOnFailure: z.boolean().optional(),
	toolCalls: z.array(toolCall).optional(),
	reused: z.boolean().optional(),
} as const;

const skippedStep = z.strictObject({
	...commonStep,
	type: stepType,
	status: z.literal("skipped"),
	skipReason: z.strictObject({
		kind: z.enum([
			"when-predicate",
			"branch-arm-not-taken",
			"parent-skipped",
			"foreach-empty",
		]),
		label: z.string().optional(),
	}),
});

const agentStep = z.strictObject({
	...commonStep,
	type: z.literal("agent"),
	status: z.enum(["success", "failed"]),
	usage: tokenUsage,
	harness: z.string().optional(),
	model: z.string().optional(),
	trajectoryDiagnostics: trajectoryDiagnostics.optional(),
});

const nonAgentStep = z.strictObject({
	...commonStep,
	type: nonAgentStepType,
	status: z.enum(["success", "failed"]),
});

const workflowStepResult = z.union([
	skippedStep,
	agentStep,
	nonAgentStep,
]) satisfies z.ZodType<WorkflowStepResult>;

const workflowRunMetadata = z.strictObject({
	metadataVersion: z.literal(WORKFLOW_RUN_METADATA_VERSION),
	id: z.string(),
	workflow: z.string(),
	definitionPath: z.string(),
	trigger: z.strictObject({
		event: z.string(),
		schemaRef: z.union([
			z.null(),
			z.strictObject({
				name: z.string().min(1),
				version: z.number().int().positive(),
			}),
		]),
		eventId: z.string().optional(),
		payload: z.record(z.string(), z.unknown()),
	}),
	triggeredByRunId: z.string().optional(),
	causedBy: z
		.strictObject({
			runId: z.string(),
			workflow: z.string(),
		})
		.optional(),
	retryOf: z.string().optional(),
	resumedFromRunId: z.string().optional(),
	tags: z.array(z.string()).optional(),
	startedAt: timestamp,
	completedAt: timestamp.optional(),
	status: z.enum([
		"running",
		"success",
		"failed",
		"interrupted",
		"completed-with-warnings",
	]),
	durationMs: duration.optional(),
	activeDurationMs: duration.optional(),
	hostSuspendedMs: duration.optional(),
	usage: tokenUsage.optional(),
	runDir: z.string(),
	steps: z.array(workflowStepResult),
	warnings: z
		.array(
			z.strictObject({
				type: z.string(),
				message: z.string(),
			}),
		)
		.optional(),
}) satisfies z.ZodType<VersionedWorkflowRunMetadata>;

type HistoricalStepFacts = Readonly<{
	id?: string;
	type?: string;
	status?: string;
	startedAt?: string;
	completedAt?: string;
	harness?: string;
	model?: string;
	usage?: AgentUsage;
}>;

export type WorkflowRunMetadataFacts = Readonly<{
	id?: string;
	workflow?: string;
	definitionPath?: string;
	status?: string;
	startedAt?: string;
	completedAt?: string;
	runDir?: string;
	triggerEvent?: string;
	trigger?: Readonly<{
		event?: string;
		schemaRef?: unknown;
		schemaVersion?: number;
		eventId?: string;
		payload?: Readonly<Record<string, unknown>>;
	}>;
	triggeredByRunId?: string;
	causedBy?: Readonly<{ runId: string; workflow: string }>;
	retryOf?: string;
	resumedFromRunId?: string;
	tags?: readonly string[];
	usage?: AgentUsage;
	steps: readonly HistoricalStepFacts[];
}>;

export type WorkflowRunMetadataDiagnostic = Readonly<{
	source: string;
	runId?: string;
	reason: string;
	recoveryAction: string;
	facts: WorkflowRunMetadataFacts;
}>;

export type WorkflowRunMetadataNormalizationResult =
	| Readonly<{ kind: "valid"; metadata: VersionedWorkflowRunMetadata }>
	| Readonly<{
			kind: "migrated";
			metadata: VersionedWorkflowRunMetadata;
			migrations: readonly string[];
	  }>
	| Readonly<{ kind: "quarantined"; diagnostic: WorkflowRunMetadataDiagnostic }>
	| Readonly<{
			kind: "invalid-authority";
			diagnostic: WorkflowRunMetadataDiagnostic;
	  }>;

type InvalidWorkflowRunMetadataNormalizationResult = Extract<
	WorkflowRunMetadataNormalizationResult,
	{ kind: "quarantined" | "invalid-authority" }
>;

export class WorkflowRunMetadataAuthorityError extends Error {
	constructor(readonly diagnostic: WorkflowRunMetadataDiagnostic) {
		super(
			`Workflow run metadata authority is invalid at ${diagnostic.source}: ` +
				`${diagnostic.reason}. Recovery: ${diagnostic.recoveryAction}`,
		);
		this.name = "WorkflowRunMetadataAuthorityError";
	}
}

export class WorkflowRunMetadataEnumerationError extends Error {
	constructor(
		readonly runsDir: string,
		cause: unknown,
	) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(
			`Workflow run metadata directory cannot be enumerated at ${runsDir}: ${reason}. ` +
				"Recovery: restore the directory as a readable directory before restarting, dispatching, or inspecting workflow runs",
		);
		this.name = "WorkflowRunMetadataEnumerationError";
	}
}

function recordValue(raw: unknown): Record<string, unknown> | null {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: null;
}

function numberValue(raw: unknown): number | undefined {
	return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
		? raw
		: undefined;
}

function maximumHistoricalNumber(...rawValues: unknown[]): number | undefined {
	let maximum: number | undefined;
	for (const raw of rawValues) {
		const value = numberValue(raw);
		if (value !== undefined && (maximum === undefined || value > maximum)) {
			maximum = value;
		}
	}
	return maximum;
}

type HistoricalUsageEnvelopeResult = Readonly<{
	usage?: AgentUsage;
	error?: string;
}>;

function historicalUsageEnvelope(
	record: Record<string, unknown>,
	field = "historical usage",
): HistoricalUsageEnvelopeResult {
	if (record.usage === undefined) return {};
	try {
		return { usage: parseAgentUsage(record.usage, field) };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const envelope = recordValue(record.usage);
		if (envelope === null) return { error: reason };

		let tokens: AgentUsage["tokens"] | undefined;
		let cost: AgentUsage["cost"] | undefined;
		try {
			tokens = parseAgentUsage(
				{ tokens: envelope.tokens, cost: { state: "unknown" } },
				field,
			).tokens;
		} catch {
			// Preserve a valid cost dimension even when tokens are malformed.
		}
		try {
			cost = parseAgentUsage(
				{ tokens: { state: "unknown" }, cost: envelope.cost },
				field,
			).cost;
		} catch {
			// Preserve a valid token dimension even when cost is malformed.
		}
		return {
			...(tokens !== undefined || cost !== undefined
				? {
						usage: {
							tokens: tokens ?? UNKNOWN_AGENT_USAGE.tokens,
							cost: cost ?? UNKNOWN_AGENT_USAGE.cost,
						},
					}
				: {}),
			error: reason,
		};
	}
}

function historicalLegacyUsage(
	record: Record<string, unknown>,
): AgentUsage | undefined {
	const output = recordValue(record.output);
	const inputTokens = maximumHistoricalNumber(
		record.inputTokens,
		output?.inputTokens,
	);
	const outputTokens = maximumHistoricalNumber(
		record.outputTokens,
		output?.outputTokens,
	);
	const cost = maximumHistoricalNumber(
		record.totalCostUsd,
		record.costUsd,
		output?.totalCostUsd,
		output?.costUsd,
	);
	return inputTokens === undefined &&
		outputTokens === undefined &&
		cost === undefined
		? undefined
		: pricedAgentUsage(inputTokens, outputTokens, cost);
}

function costFactRank(usage: AgentUsage["cost"]): number {
	return usage.state === "complete" || usage.state === "partial"
		? 2
		: usage.state === "unavailable"
			? 1
			: 0;
}

// Historical sources are overlapping cumulative checkpoints, not independent
// increments. Per-dimension maxima retain observed nonzero facts without
// double-counting them when an older writer persisted contradictory zeros. A
// maximum is exact only when one complete checkpoint contains every retained
// fact; otherwise the combined value remains a known subtotal.
function completeHistoricalTokenFacts(
	primary: AgentUsage["tokens"],
	fallback: AgentUsage["tokens"],
): AgentUsage["tokens"] {
	if (fallback.state === "unknown") return primary;
	if (primary.state === "unknown") return fallback;

	const primaryDominatesFallback =
		primary.inputTokens >= fallback.inputTokens &&
		primary.outputTokens >= fallback.outputTokens;
	const fallbackDominatesPrimary =
		fallback.inputTokens >= primary.inputTokens &&
		fallback.outputTokens >= primary.outputTokens;
	const state: "complete" | "partial" =
		(primary.state === "complete" && primaryDominatesFallback) ||
		(fallback.state === "complete" && fallbackDominatesPrimary)
			? "complete"
			: "partial";
	const completed = {
		state,
		inputTokens: Math.max(primary.inputTokens, fallback.inputTokens),
		outputTokens: Math.max(primary.outputTokens, fallback.outputTokens),
	};
	return completed.state === primary.state &&
		completed.inputTokens === primary.inputTokens &&
		completed.outputTokens === primary.outputTokens
		? primary
		: completed;
}

function completeHistoricalCostFacts(
	primary: AgentUsage["cost"],
	fallback: AgentUsage["cost"],
): AgentUsage["cost"] {
	if (
		(primary.state === "complete" || primary.state === "partial") &&
		(fallback.state === "complete" || fallback.state === "partial")
	) {
		if (fallback.usd !== primary.usd) {
			return fallback.usd > primary.usd ? fallback : primary;
		}
		return primary.state === "complete" ? primary : fallback;
	}
	return costFactRank(fallback) > costFactRank(primary) ? fallback : primary;
}

function completeHistoricalUsage(
	primary: AgentUsage | undefined,
	fallback: AgentUsage | undefined,
): AgentUsage | undefined {
	if (primary === undefined) return fallback;
	if (fallback === undefined) return primary;
	return {
		tokens: completeHistoricalTokenFacts(primary.tokens, fallback.tokens),
		cost: completeHistoricalCostFacts(primary.cost, fallback.cost),
	};
}

function completeHistoricalUsageFromSteps(
	primary: AgentUsage | undefined,
	stepAggregate: AgentUsage | undefined,
): AgentUsage | undefined {
	if (primary === undefined) return stepAggregate;
	if (stepAggregate === undefined) return primary;
	return completeHistoricalUsage(primary, stepAggregate);
}

function historicalUsage(
	record: Record<string, unknown>,
): AgentUsage | undefined {
	return completeHistoricalUsage(
		historicalUsageEnvelope(record).usage,
		historicalLegacyUsage(record),
	);
}

function malformedHistoricalUsageReason(
	record: Record<string, unknown>,
): string | null {
	const runUsage = historicalUsageEnvelope(
		record,
		"historical workflow run metadata.usage",
	);
	if (runUsage.error !== undefined) return runUsage.error;
	if (!Array.isArray(record.steps)) return null;
	for (const [index, rawStep] of record.steps.entries()) {
		const step = recordValue(rawStep);
		if (
			step === null ||
			step.type !== "agent" ||
			step.status === "skipped" ||
			step.usage === undefined
		) {
			continue;
		}
		const stepUsage = historicalUsageEnvelope(
			step,
			`historical workflow run metadata.steps.${index}.usage`,
		);
		if (stepUsage.error !== undefined) return stepUsage.error;
	}
	return null;
}

function recoverableFacts(raw: unknown): WorkflowRunMetadataFacts {
	const record = recordValue(raw);
	if (record === null) return { steps: [] };
	const trigger = recordValue(record.trigger);
	const rawSteps = Array.isArray(record.steps) ? record.steps : [];
	const steps = rawSteps.map((rawStep): HistoricalStepFacts => {
		const step = recordValue(rawStep);
		if (step === null) return {};
		const usage = historicalUsage(step);
		return {
			...(typeof step.id === "string" ? { id: step.id } : {}),
			...(typeof step.type === "string" ? { type: step.type } : {}),
			...(typeof step.status === "string" ? { status: step.status } : {}),
			...(typeof step.startedAt === "string"
				? { startedAt: step.startedAt }
				: {}),
			...(typeof step.completedAt === "string"
				? { completedAt: step.completedAt }
				: {}),
			...(typeof step.harness === "string" ? { harness: step.harness } : {}),
			...(typeof step.model === "string" ? { model: step.model } : {}),
			...(usage !== undefined ? { usage } : {}),
		};
	});
	const usage = historicalUsage(record);
	const causedBy = recordValue(record.causedBy);
	const payload = recordValue(trigger?.payload);
	const triggerFacts =
		trigger === null
			? undefined
			: {
					...(typeof trigger.event === "string"
						? { event: trigger.event }
						: {}),
					...(trigger.schemaRef !== undefined
						? { schemaRef: trigger.schemaRef }
						: {}),
					...(typeof trigger.schemaVersion === "number"
						? { schemaVersion: trigger.schemaVersion }
						: {}),
					...(typeof trigger.eventId === "string"
						? { eventId: trigger.eventId }
						: {}),
					...(payload !== null ? { payload } : {}),
				};
	return {
		...(typeof record.id === "string" ? { id: record.id } : {}),
		...(typeof record.workflow === "string"
			? { workflow: record.workflow }
			: {}),
		...(typeof record.definitionPath === "string"
			? { definitionPath: record.definitionPath }
			: {}),
		...(typeof record.status === "string" ? { status: record.status } : {}),
		...(typeof record.startedAt === "string"
			? { startedAt: record.startedAt }
			: {}),
		...(typeof record.completedAt === "string"
			? { completedAt: record.completedAt }
			: {}),
		...(typeof record.runDir === "string" ? { runDir: record.runDir } : {}),
		...(typeof trigger?.event === "string"
			? { triggerEvent: trigger.event }
			: {}),
		...(triggerFacts !== undefined ? { trigger: triggerFacts } : {}),
		...(typeof record.triggeredByRunId === "string"
			? { triggeredByRunId: record.triggeredByRunId }
			: {}),
		...(typeof causedBy?.runId === "string" &&
		typeof causedBy.workflow === "string"
			? { causedBy: { runId: causedBy.runId, workflow: causedBy.workflow } }
			: {}),
		...(typeof record.retryOf === "string" ? { retryOf: record.retryOf } : {}),
		...(typeof record.resumedFromRunId === "string"
			? { resumedFromRunId: record.resumedFromRunId }
			: {}),
		...(Array.isArray(record.tags) &&
		record.tags.every((tag) => typeof tag === "string")
			? { tags: record.tags as string[] }
			: {}),
		...(usage !== undefined ? { usage } : {}),
		steps,
	};
}

const TERMINAL_STATUS_MIGRATIONS: Readonly<
	Record<string, WorkflowRunMetadata["status"]>
> = {
	completed: "success",
	error: "failed",
	cancelled: "interrupted",
	canceled: "interrupted",
	completed_with_warnings: "completed-with-warnings",
};

const CURRENT_TERMINAL_STATUSES = new Set<string>([
	"success",
	"failed",
	"interrupted",
	"completed-with-warnings",
]);

function isPositivelyTerminalStatus(status: unknown): boolean {
	return (
		typeof status === "string" &&
		(CURRENT_TERMINAL_STATUSES.has(status) ||
			status in TERMINAL_STATUS_MIGRATIONS)
	);
}

function schemaRefForHistoricalTrigger(
	trigger: Record<string, unknown>,
	migrations: string[],
): unknown {
	const schemaRef = trigger.schemaRef;
	if (schemaRef === undefined) {
		migrations.push("trigger.schemaRef:absent-to-null");
		return null;
	}
	if (schemaRef === null) return null;
	if (typeof schemaRef === "number" && typeof trigger.event === "string") {
		migrations.push("trigger.schemaRef:number-to-reference");
		return { name: trigger.event, version: schemaRef };
	}
	if (typeof schemaRef === "string") {
		const version = numberValue(trigger.schemaVersion);
		if (version !== undefined && Number.isInteger(version) && version > 0) {
			migrations.push("trigger.schemaRef:string-to-reference");
			return { name: schemaRef, version };
		}
	}
	const reference = recordValue(schemaRef);
	if (reference !== null) {
		const name =
			typeof reference.name === "string"
				? reference.name
				: typeof reference.event === "string"
					? reference.event
					: typeof reference.schema === "string"
						? reference.schema
						: undefined;
		const version = numberValue(reference.version ?? reference.schemaVersion);
		if (
			name !== undefined &&
			version !== undefined &&
			Number.isInteger(version) &&
			version > 0
		) {
			if (reference.name !== name || reference.version !== version) {
				migrations.push("trigger.schemaRef:legacy-object-to-reference");
			}
			return { name, version };
		}
	}
	return schemaRef;
}

function historicalStep(
	raw: unknown,
	index: number,
	migrations: string[],
): unknown {
	const step = recordValue(raw);
	if (step === null) return raw;
	const migrated: Record<string, unknown> = { ...step };
	if (step.type === "agent" && step.status !== "skipped") {
		const envelopeUsage = historicalUsageEnvelope(step).usage;
		const legacyUsage = historicalLegacyUsage(step);
		const usage =
			completeHistoricalUsage(envelopeUsage, legacyUsage) ?? UNKNOWN_AGENT_USAGE;
		migrated.usage = usage;
		if (step.usage === undefined) {
			migrations.push(
				legacyUsage === undefined
					? `steps.${index}.usage:absent-to-unknown`
					: `steps.${index}.usage:legacy-fields-to-envelope`,
			);
		} else if (
			envelopeUsage === undefined ||
			usage.tokens !== envelopeUsage.tokens ||
			usage.cost !== envelopeUsage.cost
		) {
			migrations.push(`steps.${index}.usage:completed-from-legacy-fields`);
		}
	}
	delete migrated.costUsd;
	delete migrated.totalCostUsd;
	delete migrated.inputTokens;
	delete migrated.outputTokens;
	return migrated;
}

function historicalCandidate(
	raw: Record<string, unknown>,
	migrations: string[],
): Record<string, unknown> {
	const candidate: Record<string, unknown> = {
		...raw,
		metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
	};
	migrations.push("metadataVersion:unversioned-to-v1");

	const status =
		typeof raw.status === "string"
			? TERMINAL_STATUS_MIGRATIONS[raw.status]
			: undefined;
	if (status !== undefined) {
		candidate.status = status;
		migrations.push(`status:${raw.status}-to-${status}`);
	}

	const trigger = recordValue(raw.trigger);
	if (trigger !== null) {
		const migratedTrigger = { ...trigger };
		migratedTrigger.schemaRef = schemaRefForHistoricalTrigger(
			trigger,
			migrations,
		);
		delete migratedTrigger.schemaVersion;
		candidate.trigger = migratedTrigger;
	}

	const envelopeUsage = historicalUsageEnvelope(raw).usage;
	const legacyUsage = historicalLegacyUsage(raw);
	const usage = completeHistoricalUsage(envelopeUsage, legacyUsage);
	if (usage !== undefined) {
		candidate.usage = usage;
		if (raw.usage === undefined) {
			migrations.push("usage:legacy-fields-to-envelope");
		} else if (
			envelopeUsage === undefined ||
			usage.tokens !== envelopeUsage.tokens ||
			usage.cost !== envelopeUsage.cost
		) {
			migrations.push("usage:completed-from-legacy-fields");
		}
	}
	delete candidate.totalCostUsd;
	delete candidate.costUsd;
	delete candidate.inputTokens;
	delete candidate.outputTokens;

	if (Array.isArray(raw.steps)) {
		const migratedSteps: unknown[] = raw.steps.map((step, index) =>
			historicalStep(step, index, migrations),
		);
		candidate.steps = migratedSteps;
		const usages = migratedSteps.flatMap((rawStep) => {
			const step = recordValue(rawStep);
			if (step?.type !== "agent" || step.status === "skipped") return [];
			try {
				return [parseAgentUsage(step.usage, "historical step usage")];
			} catch {
				return [];
			}
		});
		if (usages.length > 0) {
			const accumulator = new AgentUsageAccumulator();
			for (const stepUsage of usages) accumulator.observe(stepUsage);
			const derivedUsage = accumulator.snapshot();
			const completedUsage = completeHistoricalUsageFromSteps(
				usage,
				derivedUsage,
			);
			candidate.usage = completedUsage;
			if (usage === undefined) {
				migrations.push("usage:derived-from-agent-steps");
			} else {
				const completedTokens = completedUsage?.tokens !== usage.tokens;
				const completedCost = completedUsage?.cost !== usage.cost;
				if (completedTokens || completedCost) {
					migrations.push("usage:completed-from-agent-steps");
				}
			}
		}
	}
	return candidate;
}

function parseFailureReason(raw: unknown, field: string): string | null {
	const parsed = workflowRunMetadata.safeParse(raw);
	if (parsed.success) return null;
	const issue = parsed.error.issues[0];
	const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
	return `${field}${path} ${issue?.message ?? "is invalid"}`;
}

function invalidResult(
	kind: "quarantined" | "invalid-authority",
	raw: unknown,
	source: string,
	reason: string,
): InvalidWorkflowRunMetadataNormalizationResult {
	const facts = recoverableFacts(raw);
	const runId = facts.id ?? basename(join(source, ".."));
	const recoveryAction =
		kind === "quarantined"
			? `Repair ${source} and retry inspection; terminal history may instead be moved to an owned quarantine namespace outside .kota/runs`
			: `Repair ${source} from its workflow.json and trigger.json evidence before restarting or dispatching the affected run; do not delete authority-bearing evidence`;
	return {
		kind,
		diagnostic: {
			source,
			...(runId.length > 0 ? { runId } : {}),
			reason,
			recoveryAction,
			facts,
		},
	};
}

/**
 * Normalize one untrusted metadata value. A record is quarantinable only when
 * its raw status or caller-supplied durable state positively proves it is
 * terminal and no recovery evidence makes the record authority-critical.
 * Ambiguous, non-terminal, and recovery-critical failures remain authority
 * errors.
 */
export function normalizeWorkflowRunMetadata(
	raw: unknown,
	source = "workflow run metadata",
	options: Readonly<{
		authorityCritical?: boolean;
		durablyTerminal?: boolean;
	}> = {},
): WorkflowRunMetadataNormalizationResult {
	const record = recordValue(raw);
	if (record === null) {
		return invalidResult(
			!options.authorityCritical && options.durablyTerminal
				? "quarantined"
				: "invalid-authority",
			raw,
			source,
			"metadata must be a JSON object",
		);
	}

	if (record.metadataVersion === WORKFLOW_RUN_METADATA_VERSION) {
		const parsed = workflowRunMetadata.safeParse(record);
		if (parsed.success) return { kind: "valid", metadata: parsed.data };
		return invalidResult(
			!options.authorityCritical &&
				(options.durablyTerminal || isPositivelyTerminalStatus(record.status))
				? "quarantined"
				: "invalid-authority",
			raw,
			source,
			parseFailureReason(record, "workflow run metadata") ??
				"metadata is invalid",
		);
	}

	if (record.metadataVersion !== undefined) {
		return invalidResult(
			!options.authorityCritical &&
				(options.durablyTerminal || isPositivelyTerminalStatus(record.status))
				? "quarantined"
				: "invalid-authority",
			raw,
			source,
			`unsupported metadataVersion ${String(record.metadataVersion)}`,
		);
	}

	const malformedUsage = malformedHistoricalUsageReason(record);
	if (malformedUsage !== null) {
		return invalidResult(
			!options.authorityCritical &&
				(options.durablyTerminal || isPositivelyTerminalStatus(record.status))
				? "quarantined"
				: "invalid-authority",
			raw,
			source,
			malformedUsage,
		);
	}

	const migrations: string[] = [];
	const candidate = historicalCandidate(record, migrations);
	const parsed = workflowRunMetadata.safeParse(candidate);
	if (parsed.success) {
		return { kind: "migrated", metadata: parsed.data, migrations };
	}
	return invalidResult(
		!options.authorityCritical &&
			(options.durablyTerminal || isPositivelyTerminalStatus(record.status))
			? "quarantined"
			: "invalid-authority",
		raw,
		source,
		parseFailureReason(candidate, "historical workflow run metadata") ??
			"historical metadata cannot be normalized",
	);
}

/** Decode only the current representation. Historical input uses the normalizer. */
export function parseWorkflowRunMetadata(
	raw: unknown,
	field = "workflow run metadata",
): VersionedWorkflowRunMetadata {
	const parsed = workflowRunMetadata.safeParse(raw);
	if (parsed.success) return parsed.data;
	throw new Error(parseFailureReason(raw, field) ?? `${field} is invalid`);
}

function readWorkflowRunMetadataResult(
	path: string,
	options: Readonly<{
		authorityCritical?: boolean;
		durablyTerminal?: boolean;
	}> = {},
): WorkflowRunMetadataNormalizationResult | null {
	let raw: unknown;
	try {
		raw = readOptionalJsonFile<unknown>(path);
	} catch (error) {
		return invalidResult(
			!options.authorityCritical &&
				options.durablyTerminal &&
				error instanceof JsonFileError &&
				error.operation === "parse"
				? "quarantined"
				: "invalid-authority",
			null,
			path,
			error instanceof Error ? error.message : String(error),
		);
	}
	return raw === null ? null : normalizeWorkflowRunMetadata(raw, path, options);
}

function storedWorkflowRunMetadataResult(
	metadata: VersionedWorkflowRunMetadata,
	path: string,
	options: Readonly<{
		authorityCritical?: boolean;
		durablyTerminal?: boolean;
	}> = {},
):
	| Readonly<{ kind: "stored"; metadata: StoredWorkflowRunMetadata }>
	| InvalidWorkflowRunMetadataNormalizationResult {
	const directoryId = basename(dirname(path));
	let validatedDirectoryId: string;
	try {
		validatedDirectoryId = validateWorkflowRunId(
			directoryId,
			"Stored workflow run directory",
		);
	} catch (error) {
		return invalidResult(
			options.authorityCritical ||
				(!options.durablyTerminal && metadata.status === "running")
				? "invalid-authority"
				: "quarantined",
			metadata,
			path,
			error instanceof Error ? error.message : String(error),
		);
	}
	if (metadata.id !== validatedDirectoryId) {
		return invalidResult(
			options.authorityCritical ||
				(!options.durablyTerminal && metadata.status === "running")
				? "invalid-authority"
				: "quarantined",
			metadata,
			path,
			`metadata id ${JSON.stringify(metadata.id)} does not match directory ${JSON.stringify(validatedDirectoryId)}`,
		);
	}
	return {
		kind: "stored",
		metadata: {
			...metadata,
			id: validatedDirectoryId as StoredWorkflowRunDirectoryId,
		},
	};
}

/**
 * Direct lookup is strict: quarantined and authority-invalid records both fail
 * closed. `operationallyActive` makes the record authority-bearing, but does
 * not constrain its evidence status: execution metadata is finalized before
 * integration, backoff waiting, and some attention transitions complete in
 * durable workflow state.
 */
export function readWorkflowRunMetadataFile(
	path: string,
	options: Readonly<{
		authorityCritical: true;
		operationallyActive?: boolean;
	}>,
): StoredWorkflowRunMetadata;
export function readWorkflowRunMetadataFile(
	path: string,
	options?: Readonly<{
		authorityCritical?: false;
		operationallyActive?: false;
	}>,
): StoredWorkflowRunMetadata | null;
export function readWorkflowRunMetadataFile(
	path: string,
	options: Readonly<{
		authorityCritical?: boolean;
		operationallyActive?: boolean;
	}> = {},
): StoredWorkflowRunMetadata | null {
	const authorityCritical =
		options.authorityCritical === true || options.operationallyActive === true;
	const result = readWorkflowRunMetadataResult(path, { authorityCritical });
	if (result === null) {
		if (!authorityCritical) return null;
		const missing = invalidResult(
			"invalid-authority",
			null,
			path,
			"metadata file is missing for an authority-critical workflow run",
		);
		throw new WorkflowRunMetadataAuthorityError(missing.diagnostic);
	}
	if (result.kind === "valid" || result.kind === "migrated") {
		const stored = storedWorkflowRunMetadataResult(result.metadata, path, {
			authorityCritical: true,
		});
		if (stored.kind === "stored") {
			return stored.metadata;
		}
		throw new WorkflowRunMetadataAuthorityError(stored.diagnostic);
	}
	if (result.kind === "invalid-authority") {
		throw new WorkflowRunMetadataAuthorityError(result.diagnostic);
	}
	throw new JsonFileError(
		path,
		"parse",
		`terminal workflow history is quarantined: ${result.diagnostic.reason}. ` +
			`Recovery: ${result.diagnostic.recoveryAction}`,
	);
}

export type WorkflowRunMetadataEnumeration = Readonly<{
	runs: readonly StoredWorkflowRunMetadata[];
	diagnostics: readonly WorkflowRunMetadataDiagnostic[];
}>;

function defaultEnumerationWarning(
	diagnostic: WorkflowRunMetadataDiagnostic,
): void {
	process.emitWarning(
		`Quarantined workflow run metadata at ${diagnostic.source}: ${diagnostic.reason}. ` +
			`Recovery: ${diagnostic.recoveryAction}`,
		{ code: "KOTA_WORKFLOW_RUN_METADATA_QUARANTINED" },
	);
}

/**
 * The single collection owner for persisted run metadata. Child directories
 * without metadata.json are ignored unless durable state identifies them as
 * authority-critical. Malformed terminal history is diagnosed and skipped,
 * while ambiguous or active authority fails closed.
 */
export function enumerateWorkflowRunMetadata(
	runsDir: string,
	options: Readonly<{
		authorityCriticalRunIds: ReadonlySet<string>;
		operationallyActiveRunIds?: ReadonlySet<string>;
		terminalRunIds?: ReadonlySet<string>;
		onDiagnostic?: (diagnostic: WorkflowRunMetadataDiagnostic) => void;
		maxWarnings?: number;
	}>,
): WorkflowRunMetadataEnumeration {
	let entries: Dirent[];
	try {
		entries = readdirSync(runsDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			entries = [];
		} else {
			throw new WorkflowRunMetadataEnumerationError(runsDir, error);
		}
	}
	const runs: StoredWorkflowRunMetadata[] = [];
	const diagnostics: WorkflowRunMetadataDiagnostic[] = [];
	const checkedAuthorityCriticalRunIds = new Set<string>();
	const maxWarnings = options.maxWarnings ?? MAX_ENUMERATION_WARNINGS;
	const onDiagnostic = options.onDiagnostic ?? defaultEnumerationWarning;

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const path = join(runsDir, entry.name, "metadata.json");
		const operationallyActive =
			options.operationallyActiveRunIds?.has(entry.name) ?? false;
		const durablyTerminal = options.terminalRunIds?.has(entry.name) ?? false;
		const authorityCritical =
			operationallyActive || options.authorityCriticalRunIds.has(entry.name);
		if (authorityCritical) {
			checkedAuthorityCriticalRunIds.add(entry.name);
			const metadata = readWorkflowRunMetadataFile(path, {
				authorityCritical: true,
				operationallyActive,
			});
			runs.push(metadata);
			continue;
		}
		if (!existsSync(path)) continue;
		const result = readWorkflowRunMetadataResult(path, {
			authorityCritical,
			durablyTerminal,
		});
		if (result === null) continue;
		if (result.kind === "invalid-authority") {
			throw new WorkflowRunMetadataAuthorityError(result.diagnostic);
		}
		if (result.kind === "quarantined") {
			diagnostics.push(result.diagnostic);
			if (diagnostics.length <= maxWarnings) onDiagnostic(result.diagnostic);
			continue;
		}
		const stored = storedWorkflowRunMetadataResult(result.metadata, path, {
			authorityCritical,
			durablyTerminal,
		});
		if (stored.kind !== "stored") {
			if (stored.kind === "invalid-authority") {
				throw new WorkflowRunMetadataAuthorityError(stored.diagnostic);
			}
			if (stored.kind === "quarantined") {
				diagnostics.push(stored.diagnostic);
				if (diagnostics.length <= maxWarnings)
					onDiagnostic(stored.diagnostic);
			}
			continue;
		}
		runs.push(stored.metadata);
	}

	const requiredRunIds = new Set(options.authorityCriticalRunIds);
	for (const runId of options.operationallyActiveRunIds ?? []) {
		requiredRunIds.add(runId);
	}
	for (const runId of requiredRunIds) {
		if (checkedAuthorityCriticalRunIds.has(runId)) continue;
		const path = join(runsDir, runId, "metadata.json");
		const operationallyActive =
			options.operationallyActiveRunIds?.has(runId) ?? false;
		readWorkflowRunMetadataFile(path, {
			authorityCritical: true,
			operationallyActive,
		});
	}

	if (diagnostics.length > maxWarnings) {
		onDiagnostic({
			source: runsDir,
			reason: `${diagnostics.length - maxWarnings} additional terminal metadata records were quarantined`,
			recoveryAction:
				"Inspect the run metadata diagnostics after repairing the first bounded warning set",
			facts: { steps: [] },
		});
	}
	return { runs, diagnostics };
}
