import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	enumerateWorkflowRunMetadata,
	normalizeWorkflowRunMetadata,
	parseWorkflowRunMetadata,
	readWorkflowRunMetadataFile,
	WORKFLOW_RUN_METADATA_VERSION,
	WorkflowRunMetadataAuthorityError,
	WorkflowRunMetadataEnumerationError,
	workflowRunMetadataAuthorityCriticalIds,
	workflowRunMetadataTerminalIds,
} from "./run-metadata.js";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function canonicalMetadata() {
	return {
		metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
		id: "run-1",
		workflow: "builder",
		definitionPath: "workflow.ts",
		trigger: { event: "manual", schemaRef: null, payload: {} },
		startedAt: "2026-08-26T00:00:00.000Z",
		completedAt: "2026-08-26T00:01:00.000Z",
		status: "success",
		runDir: ".kota/runs/run-1",
		steps: [
			{
				id: "build",
				type: "agent",
				status: "success",
				startedAt: "2026-08-26T00:00:00.000Z",
				completedAt: "2026-08-26T00:01:00.000Z",
				durationMs: 60_000,
				usage: {
					tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
					cost: { state: "complete", usd: 0.25 },
				},
			},
		],
	};
}

function historicalMetadata(overrides: Record<string, unknown> = {}) {
	const current = canonicalMetadata();
	const { metadataVersion: _, ...historical } = current;
	return { ...historical, ...overrides };
}

function createRunsDir(): string {
	const root = mkdtempSync(join(tmpdir(), "kota-run-metadata-"));
	tempRoots.push(root);
	const runsDir = join(root, "runs");
	mkdirSync(runsDir);
	return runsDir;
}

function writeMetadata(runsDir: string, runId: string, value: unknown): string {
	const runDir = join(runsDir, runId);
	mkdirSync(runDir);
	const path = join(runDir, "metadata.json");
	writeFileSync(path, JSON.stringify(value), "utf-8");
	return path;
}

describe("workflow run metadata normalization", () => {
	it("accepts only the explicit current representation as valid", () => {
		expect(parseWorkflowRunMetadata(canonicalMetadata()).metadataVersion).toBe(
			1,
		);
		expect(normalizeWorkflowRunMetadata(canonicalMetadata()).kind).toBe(
			"valid",
		);
		expect(() => parseWorkflowRunMetadata(historicalMetadata())).toThrow(
			"workflow run metadata.metadataVersion",
		);
	});

	it.each([
		[undefined, null],
		[3, { name: "manual", version: 3 }],
		["manual.schema", { name: "manual.schema", version: 4 }],
		[
			{ event: "manual.schema", schemaVersion: 5 },
			{ name: "manual.schema", version: 5 },
		],
	])("migrates historical schemaRef form %#", (schemaRef, expected) => {
		const trigger: Record<string, unknown> = {
			event: "manual",
			payload: { source: "historical" },
		};
		if (schemaRef !== undefined) trigger.schemaRef = schemaRef;
		if (typeof schemaRef === "string") trigger.schemaVersion = 4;
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({ trigger }),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.trigger).toEqual({
				event: "manual",
				schemaRef: expected,
				payload: { source: "historical" },
			});
		}
	});

	it("preserves legacy top-level and step token and cost facts", () => {
		const current = canonicalMetadata();
		const step = { ...current.steps[0] } as Record<string, unknown>;
		delete step.usage;
		Object.assign(step, {
			inputTokens: 70,
			outputTokens: 11,
			costUsd: 0.12,
		});
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: undefined,
				inputTokens: 100,
				totalCostUsd: 0.25,
				steps: [step],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 100, outputTokens: 11 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.metadata.steps[0]?.usage).toEqual({
				tokens: { state: "complete", inputTokens: 70, outputTokens: 11 },
				cost: { state: "complete", usd: 0.12 },
			});
		}
	});

	it("merges complementary partial token dimensions before removing legacy fields", () => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: {
					tokens: { state: "partial", inputTokens: 100, outputTokens: 0 },
					cost: { state: "unknown" },
				},
				outputTokens: 20,
				steps: [],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "partial", inputTokens: 100, outputTokens: 20 },
				cost: { state: "unknown" },
			});
		}
	});

	it("completes partial run usage from aggregate agent-step dimensions", () => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: {
					tokens: { state: "partial", inputTokens: 100, outputTokens: 0 },
					cost: { state: "unknown" },
				},
				steps: [canonicalMetadata().steps[0]],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.migrations).toContain("usage:completed-from-agent-steps");
		}
	});

	it.each([
		[
			"unknown",
			{
				tokens: { state: "unknown" },
				cost: { state: "unknown" },
			},
		],
		[
			"partial",
			{
				tokens: { state: "partial", inputTokens: 1, outputTokens: 0 },
				cost: { state: "unknown" },
			},
		],
	])("completes a %s usage envelope from known legacy facts", (_, usage) => {
		const step = {
			...canonicalMetadata().steps[0],
			usage,
			inputTokens: 70,
			outputTokens: 11,
			costUsd: 0.12,
		};
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage,
				inputTokens: 100,
				outputTokens: 20,
				totalCostUsd: 0.25,
				steps: [step],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.metadata.steps[0]?.usage).toEqual({
				tokens: { state: "complete", inputTokens: 70, outputTokens: 11 },
				cost: { state: "complete", usd: 0.12 },
			});
			expect(result.migrations).toContain(
				"usage:completed-from-legacy-fields",
			);
			expect(result.migrations).toContain(
				"steps.0.usage:completed-from-legacy-fields",
			);
		}
	});

	it("preserves nonzero legacy facts that contradict a complete zero run envelope", () => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: {
					tokens: { state: "complete", inputTokens: 0, outputTokens: 0 },
					cost: { state: "complete", usd: 0 },
				},
				inputTokens: 100,
				outputTokens: 20,
				totalCostUsd: 0.25,
				steps: [],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.migrations).toContain(
				"usage:completed-from-legacy-fields",
			);
		}
	});

	it("preserves nonzero step legacy facts that contradict a complete zero envelope", () => {
		const step = {
			...canonicalMetadata().steps[0],
			usage: {
				tokens: { state: "complete", inputTokens: 0, outputTokens: 0 },
				cost: { state: "complete", usd: 0 },
			},
			inputTokens: 70,
			outputTokens: 11,
			costUsd: 0.12,
		};
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({ usage: undefined, steps: [step] }),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.steps[0]?.usage).toEqual({
				tokens: { state: "complete", inputTokens: 70, outputTokens: 11 },
				cost: { state: "complete", usd: 0.12 },
			});
			expect(result.metadata.usage).toEqual(
				result.metadata.steps[0]?.usage,
			);
			expect(result.migrations).toContain(
				"steps.0.usage:completed-from-legacy-fields",
			);
		}
	});

	it("preserves nonzero step aggregates that contradict complete zero run usage", () => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: {
					tokens: { state: "complete", inputTokens: 0, outputTokens: 0 },
					cost: { state: "complete", usd: 0 },
				},
				steps: [canonicalMetadata().steps[0]],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.migrations).toContain("usage:completed-from-agent-steps");
		}
	});

	it("keeps a known step subtotal partial when another historical agent step has unknown usage", () => {
		const knownStep = canonicalMetadata().steps[0];
		const unknownStep = {
			...knownStep,
			id: "critic",
		};
		delete (unknownStep as Partial<typeof knownStep>).usage;
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: {
					tokens: { state: "complete", inputTokens: 0, outputTokens: 0 },
					cost: { state: "complete", usd: 0 },
				},
				steps: [knownStep, unknownStep],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "partial", inputTokens: 100, outputTokens: 20 },
				cost: { state: "partial", usd: 0.25 },
			});
			expect(result.metadata.steps[1]?.usage).toEqual({
				tokens: { state: "unknown" },
				cost: { state: "unknown" },
			});
		}
	});

	it("preserves a known step cost subtotal when another historical step has unknown usage", () => {
		const knownStep = canonicalMetadata().steps[0];
		const unknownStep = {
			...knownStep,
			id: "critic",
		};
		delete (unknownStep as Partial<typeof knownStep>).usage;
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: undefined,
				totalCostUsd: 0,
				steps: [knownStep, unknownStep],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage?.cost).toEqual({
				state: "partial",
				usd: 0.25,
			});
			expect(result.metadata.steps[0]?.usage?.cost).toEqual({
				state: "complete",
				usd: 0.25,
			});
			expect(result.metadata.steps[1]?.usage?.cost).toEqual({
				state: "unknown",
			});
		}
	});

	it("preserves the greatest known fact across conflicting legacy aliases", () => {
		const current = canonicalMetadata();
		const step = { ...current.steps[0] } as Record<string, unknown>;
		delete step.usage;
		Object.assign(step, {
			inputTokens: 0,
			outputTokens: 0,
			totalCostUsd: 0,
			costUsd: 0.12,
			output: {
				inputTokens: 70,
				outputTokens: 11,
				totalCostUsd: 0.1,
				costUsd: 0.15,
			},
		});
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: undefined,
				totalCostUsd: 0,
				costUsd: 0.25,
				steps: [step],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.usage).toEqual({
				tokens: { state: "complete", inputTokens: 70, outputTokens: 11 },
				cost: { state: "complete", usd: 0.25 },
			});
			expect(result.metadata.steps[0]?.usage).toEqual({
				tokens: { state: "complete", inputTokens: 70, outputTokens: 11 },
				cost: { state: "complete", usd: 0.15 },
			});
		}
	});

	it("recovers agent token facts nested in historical step output", () => {
		const current = canonicalMetadata();
		const step = { ...current.steps[0] } as Record<string, unknown>;
		delete step.usage;
		Object.assign(step, {
			costUsd: 0,
			output: {
				inputTokens: 15_268_507,
				outputTokens: 69_116,
				totalCostUsd: 0,
			},
		});
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: undefined,
				costUsd: 0,
				steps: [step],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			const expectedUsage = {
				tokens: {
					state: "complete",
					inputTokens: 15_268_507,
					outputTokens: 69_116,
				},
				cost: { state: "complete", usd: 0 },
			};
			expect(result.metadata.steps[0]?.usage).toEqual(expectedUsage);
			expect(result.metadata.usage).toEqual(expectedUsage);
		}
	});

	it.each([
		["completed", "success"],
		["error", "failed"],
		["cancelled", "interrupted"],
		["canceled", "interrupted"],
		["completed_with_warnings", "completed-with-warnings"],
	])("maps legacy terminal status %s", (status, expected) => {
		const result = normalizeWorkflowRunMetadata(historicalMetadata({ status }));
		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated")
			expect(result.metadata.status).toBe(expected);
	});

	it("marks missing historical agent usage explicitly unknown", () => {
		const current = canonicalMetadata();
		const step = { ...current.steps[0] } as Record<string, unknown>;
		delete step.usage;
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				usage: undefined,
				steps: [step],
			}),
		);

		expect(result.kind).toBe("migrated");
		if (result.kind === "migrated") {
			expect(result.metadata.steps[0]?.usage).toEqual({
				tokens: { state: "unknown" },
				cost: { state: "unknown" },
			});
			expect(result.metadata.usage).toEqual({
				tokens: { state: "unknown" },
				cost: { state: "unknown" },
			});
		}
	});

	it("quarantines malformed terminal history while retaining recoverable facts", () => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				definitionPath: 17,
				inputTokens: 44,
				outputTokens: 9,
				totalCostUsd: 0.4,
				retryOf: "run-previous",
				tags: ["historical", "builder"],
			}),
			"/scope/.kota/runs/run-1/metadata.json",
		);

		expect(result.kind).toBe("quarantined");
		if (result.kind === "quarantined") {
			expect(result.diagnostic.facts).toMatchObject({
				id: "run-1",
				workflow: "builder",
				status: "success",
				triggerEvent: "manual",
				trigger: {
					event: "manual",
					schemaRef: null,
					payload: {},
				},
				retryOf: "run-previous",
				tags: ["historical", "builder"],
				usage: {
					tokens: { state: "complete", inputTokens: 44, outputTokens: 9 },
					cost: { state: "complete", usd: 0.4 },
				},
			});
			expect(result.diagnostic.recoveryAction).toContain("outside .kota/runs");
		}
	});

	it("quarantines malformed historical usage without erasing its valid token facts", () => {
		const current = canonicalMetadata();
		const step = {
			...current.steps[0],
			usage: {
				tokens: { state: "complete", inputTokens: 91, outputTokens: 17 },
				cost: { state: "complete", usd: "invalid" },
			},
		};
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({ usage: undefined, steps: [step] }),
			"/scope/.kota/runs/run-1/metadata.json",
		);

		expect(result.kind).toBe("quarantined");
		if (result.kind === "quarantined") {
			expect(result.diagnostic.reason).toContain(
				"steps.0.usage.cost.usd must be a non-negative finite number",
			);
			expect(result.diagnostic.facts.steps[0]?.usage).toEqual({
				tokens: { state: "complete", inputTokens: 91, outputTokens: 17 },
				cost: { state: "unknown" },
			});
		}
	});

	it("quarantines terminal metadata with an invalid timestamp", () => {
		const result = normalizeWorkflowRunMetadata({
			...canonicalMetadata(),
			startedAt: "not-a-timestamp",
		});

		expect(result.kind).toBe("quarantined");
		if (result.kind === "quarantined") {
			expect(result.diagnostic.reason).toContain(
				"workflow run metadata.startedAt must be an ISO 8601 timestamp",
			);
		}
	});

	it.each([
		"running",
		"waiting",
		"integrating",
		undefined,
	])("fails closed when malformed status %s does not prove terminal history", (status) => {
		const result = normalizeWorkflowRunMetadata(
			historicalMetadata({
				definitionPath: 17,
				status,
			}),
			"/scope/.kota/runs/run-1/metadata.json",
		);
		expect(result.kind).toBe("invalid-authority");
		if (result.kind === "invalid-authority") {
			expect(result.diagnostic.recoveryAction).toContain(
				"before restarting or dispatching",
			);
		}
	});

	it("fails closed for invalid timestamps on authority-bearing metadata", () => {
		const result = normalizeWorkflowRunMetadata({
			...canonicalMetadata(),
			status: "running",
			completedAt: undefined,
			startedAt: "not-a-timestamp",
		});

		expect(result.kind).toBe("invalid-authority");
	});
});

describe("workflow run metadata enumeration", () => {
	it("derives authority from active states and undelivered publications", () => {
		const ids = workflowRunMetadataAuthorityCriticalIds([
			{ id: "queued", state: "queued" },
			{ id: "running", state: "running" },
			{ id: "waiting", state: "waiting" },
			{ id: "integrating", state: "integrating" },
			{ id: "attention", state: "needs_attention" },
			{ id: "succeeded", state: "succeeded" },
		], [
			{ runId: "succeeded" },
			{ runId: "publication-only" },
		]);

		expect([...ids]).toEqual([
			"running",
			"waiting",
			"integrating",
			"attention",
			"succeeded",
			"publication-only",
		]);
	});

	it("derives positive terminal authority only from durable terminal states", () => {
		expect([...workflowRunMetadataTerminalIds([
			{ id: "queued", state: "queued" },
			{ id: "running", state: "running" },
			{ id: "succeeded", state: "succeeded" },
			{ id: "failed", state: "failed" },
			{ id: "cancelled", state: "cancelled" },
		])]).toEqual(["succeeded", "failed", "cancelled"]);
	});

	it("quarantines invalid JSON only when durable state proves terminal history", () => {
		const runsDir = createRunsDir();
		const runDir = join(runsDir, "terminal-run");
		mkdirSync(runDir);
		writeFileSync(join(runDir, "metadata.json"), "{invalid", "utf-8");
		const diagnostics: string[] = [];

		const result = enumerateWorkflowRunMetadata(runsDir, {
			authorityCriticalRunIds: new Set(),
			terminalRunIds: new Set(["terminal-run"]),
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.reason),
		});

		expect(result.runs).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toContain("invalid JSON");
	});

	it("treats an absent store as empty but fails closed when the store is unreadable", () => {
		const runsDir = createRunsDir();
		expect(enumerateWorkflowRunMetadata(join(runsDir, "absent"), {
			authorityCriticalRunIds: new Set(),
		})).toEqual({
			runs: [],
			diagnostics: [],
		});

		const notDirectory = join(runsDir, "not-a-directory");
		writeFileSync(notDirectory, "not a directory", "utf-8");
		expect(() => enumerateWorkflowRunMetadata(notDirectory, {
			authorityCriticalRunIds: new Set(),
		})).toThrow(
			WorkflowRunMetadataEnumerationError,
		);
		expect(() => enumerateWorkflowRunMetadata(notDirectory, {
			authorityCriticalRunIds: new Set(),
		})).toThrow(
			"restore the directory as a readable directory before restarting, dispatching, or inspecting workflow runs",
		);
	});

	it("ignores non-run child directories and surfaces bounded terminal quarantine warnings", () => {
		const runsDir = createRunsDir();
		mkdirSync(join(runsDir, "fixture-report"));
		writeFileSync(
			join(runsDir, "fixture-report", "report.json"),
			"{}",
			"utf-8",
		);
		writeMetadata(runsDir, "run-1", canonicalMetadata());
		for (const runId of ["bad-1", "bad-2", "bad-3"]) {
			writeMetadata(
				runsDir,
				runId,
				historicalMetadata({
					id: runId,
					runDir: `.kota/runs/${runId}`,
					definitionPath: 17,
				}),
			);
		}
		const warnings: string[] = [];
		const result = enumerateWorkflowRunMetadata(runsDir, {
			authorityCriticalRunIds: new Set(),
			maxWarnings: 1,
			onDiagnostic: (diagnostic) => warnings.push(diagnostic.reason),
		});

		expect(result.runs.map((run) => run.id)).toEqual(["run-1"]);
		expect(result.diagnostics).toHaveLength(3);
		expect(warnings).toHaveLength(2);
		expect(warnings[1]).toContain("2 additional");
	});

	it("stops enumeration and direct lookup for malformed authority metadata", () => {
		const runsDir = createRunsDir();
		const path = writeMetadata(
			runsDir,
			"active-run",
			historicalMetadata({
				id: "active-run",
				runDir: ".kota/runs/active-run",
				status: "running",
				definitionPath: 17,
			}),
		);

		expect(() =>
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(),
				onDiagnostic: () => {},
			}),
		).toThrow(WorkflowRunMetadataAuthorityError);
		expect(() => readWorkflowRunMetadataFile(path)).toThrow("Repair");
	});

	it("binds direct lookup to the requested run directory and fails closed when authority metadata is missing", () => {
		const runsDir = createRunsDir();
		const mismatchedPath = writeMetadata(
			runsDir,
			"active-run",
			canonicalMetadata(),
		);

		expect(() => readWorkflowRunMetadataFile(mismatchedPath)).toThrow(
			WorkflowRunMetadataAuthorityError,
		);
		expect(() => readWorkflowRunMetadataFile(mismatchedPath)).toThrow(
			'metadata id "run-1" does not match directory "active-run"',
		);
		expect(() =>
			readWorkflowRunMetadataFile(
				join(runsDir, "missing-run", "metadata.json"),
				{ authorityCritical: true },
			),
		).toThrow("metadata file is missing for an authority-critical workflow run");
	});

	it("fails closed when an authority-critical run directory has no metadata", () => {
		const runsDir = createRunsDir();
		mkdirSync(join(runsDir, "waiting-run"));

		expect(() =>
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(["waiting-run"]),
				onDiagnostic: () => {},
			}),
		).toThrow("metadata file is missing for an authority-critical workflow run");
	});

	it("fails closed when an authority-critical run directory is entirely absent", () => {
		const runsDir = createRunsDir();

		expect(() =>
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(["integrating-run"]),
				onDiagnostic: () => {},
			}),
		).toThrow("metadata file is missing for an authority-critical workflow run");
	});

	it("quarantines noncanonical terminal directory identities in the canonical enumerator", () => {
		const runsDir = createRunsDir();
		writeMetadata(
			runsDir,
			"unsafe directory",
			canonicalMetadata(),
		);
		const diagnostics: string[] = [];

		const result = enumerateWorkflowRunMetadata(runsDir, {
			authorityCriticalRunIds: new Set(),
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.reason),
		});

		expect(result.runs).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toContain("must be a path-safe segment");
	});

	it("fails closed when durable state marks malformed terminal metadata authority-critical", () => {
		const runsDir = createRunsDir();
		writeMetadata(
			runsDir,
			"integrating-run",
			historicalMetadata({
				id: "integrating-run",
				runDir: ".kota/runs/integrating-run",
				status: "success",
				definitionPath: 17,
			}),
		);

		expect(() =>
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(["integrating-run"]),
				onDiagnostic: () => {},
			}),
		).toThrow(WorkflowRunMetadataAuthorityError);
	});

	it("accepts finalized execution metadata while durable state remains operationally active", () => {
		const runsDir = createRunsDir();
		const path = writeMetadata(runsDir, "run-1", canonicalMetadata());

		expect(
			readWorkflowRunMetadataFile(path, {
				authorityCritical: true,
				operationallyActive: true,
			}).status,
		).toBe("success");

		expect(
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(["run-1"]),
				operationallyActiveRunIds: new Set(["run-1"]),
				onDiagnostic: () => {},
			}).runs.map((run) => run.id),
		).toEqual(["run-1"]);
	});

	it("accepts valid terminal metadata when only an undelivered publication retains authority", () => {
		const runsDir = createRunsDir();
		writeMetadata(runsDir, "run-1", canonicalMetadata());

		expect(
			enumerateWorkflowRunMetadata(runsDir, {
				authorityCriticalRunIds: new Set(["run-1"]),
				operationallyActiveRunIds: new Set(),
				onDiagnostic: () => {},
			}).runs.map((run) => run.id),
		).toEqual(["run-1"]);
	});

	it("returns normalized historical reads in the current representation", () => {
		const runsDir = createRunsDir();
		const path = writeMetadata(
			runsDir,
			"run-1",
			historicalMetadata({
				totalCostUsd: 0,
				inputTokens: 5,
				outputTokens: 2,
				steps: [],
			}),
		);

		expect(readWorkflowRunMetadataFile(path)).toMatchObject({
			metadataVersion: 1,
			usage: {
				tokens: { state: "complete", inputTokens: 5, outputTokens: 2 },
				cost: { state: "complete", usd: 0 },
			},
		});
	});
});
