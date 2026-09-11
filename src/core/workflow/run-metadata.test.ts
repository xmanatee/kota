import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import {
  enumerateWorkflowRunMetadata, normalizeWorkflowRunMetadata,
  parseWorkflowRunMetadata, readWorkflowRunMetadataFile,
  WORKFLOW_RUN_METADATA_VERSION, WorkflowRunMetadataAuthorityError,
  WorkflowRunMetadataEnumerationError, workflowRunMetadataAuthorityCriticalIds,
  workflowRunMetadataTerminalIds,
} from "./run-metadata.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const unknownUsage = { tokens: { state: "unknown" }, cost: { state: "unknown" } } as const;
function usage(inputTokens: number, outputTokens: number, usd: number, state: "complete" | "partial" = "complete"): AgentUsage {
  return { tokens: { state, inputTokens, outputTokens }, cost: { state, usd } };
}
function metadata(overrides: Record<string, unknown> = {}) {
  return {
    metadataVersion: WORKFLOW_RUN_METADATA_VERSION, id: "run-1", workflow: "builder",
    definitionPath: "workflow.ts", trigger: { event: "manual", schemaRef: null, payload: {} },
    startedAt: "2026-08-26T00:00:00.000Z", completedAt: "2026-08-26T00:01:00.000Z",
    status: "success", runDir: ".kota/runs/run-1",
    steps: [{ id: "build", type: "agent", status: "success",
      startedAt: "2026-08-26T00:00:00.000Z", completedAt: "2026-08-26T00:01:00.000Z",
      durationMs: 60_000, usage: usage(100, 20, 0.25) }], ...overrides,
  };
}
function historical(overrides: Record<string, unknown> = {}) {
  const { metadataVersion: _, ...raw } = metadata(overrides);
  return raw;
}
function step(overrides: Record<string, unknown> = {}) {
  return { ...metadata().steps[0], usage: undefined, ...overrides };
}
function migrated(raw: unknown) {
  const result = normalizeWorkflowRunMetadata(raw);
  expect(result.kind).toBe("migrated");
  if (result.kind !== "migrated") throw new Error(JSON.stringify(result));
  return result.metadata;
}
function runsDir() {
  const root = mkdtempSync(join(tmpdir(), "kota-run-metadata-"));
  roots.push(root);
  return root;
}
function writeMetadata(root: string, id: string, raw: unknown = metadata()) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "metadata.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

it("decodes current metadata without silently accepting an unversioned record", () => {
  const raw = metadata();
  expect(parseWorkflowRunMetadata(raw)).toEqual(raw);
  expect(normalizeWorkflowRunMetadata(raw)).toEqual({ kind: "valid", metadata: raw });
  expect(() => parseWorkflowRunMetadata(historical())).toThrow("metadataVersion");
});

it.each([
  [undefined, null], [3, { name: "manual", version: 3 }],
  ["manual.schema", { name: "manual.schema", version: 4 }],
  [{ event: "manual.schema", schemaVersion: 5 }, { name: "manual.schema", version: 5 }],
])("normalizes persisted trigger schema reference %#", (schemaRef, expected) => {
  const trigger = { event: "manual", schemaRef, schemaVersion: 4, payload: { source: "historical" } };
  expect(migrated(historical({ trigger })).trigger).toEqual({
    event: "manual", schemaRef: expected, payload: { source: "historical" },
  });
});

it.each([
  ["completed", "success"], ["error", "failed"], ["cancelled", "interrupted"],
  ["canceled", "interrupted"], ["completed_with_warnings", "completed-with-warnings"],
])("normalizes persisted terminal status %s", (status, expected) => {
  expect(migrated(historical({ status })).status).toBe(expected);
});

it.each([
  { name: "legacy dimensions at run and step", raw: {
    inputTokens: 100, totalCostUsd: 0.25, steps: [step({ inputTokens: 70, outputTokens: 11, costUsd: 0.12 })],
  }, run: { tokens: { state: "partial", inputTokens: 100, outputTokens: 11 }, cost: { state: "complete", usd: 0.25 } }, steps: [usage(70, 11, 0.12)] },
  { name: "complementary partial dimensions", raw: {
    usage: { tokens: { state: "partial", inputTokens: 100, outputTokens: 0 }, cost: { state: "unknown" } },
    outputTokens: 20, steps: [],
  }, run: { tokens: { state: "partial", inputTokens: 100, outputTokens: 20 }, cost: { state: "unknown" } }, steps: [] },
  ...[unknownUsage, usage(1, 0, 0, "partial"), usage(0, 0, 0)].map((envelope, index) => ({
    name: `legacy facts complete envelope ${index}`, raw: {
      usage: envelope, inputTokens: 100, outputTokens: 20, totalCostUsd: 0.25,
      steps: [step({ usage: envelope, inputTokens: 70, outputTokens: 11, costUsd: 0.12 })],
    }, run: usage(100, 20, 0.25), steps: [usage(70, 11, 0.12)],
  })),
  ...[usage(100, 0, 0, "partial"), usage(0, 0, 0)].map((envelope, index) => ({
    name: `step aggregate completes envelope ${index}`, raw: { usage: envelope },
    run: usage(100, 20, 0.25), steps: [usage(100, 20, 0.25)],
  })),
  ...[usage(0, 0, 0), undefined].map((envelope, index) => ({
    name: `unknown step keeps subtotal partial ${index}`, raw: {
      usage: envelope, totalCostUsd: 0,
      steps: [metadata().steps[0], step({ id: "critic" })],
    }, run: usage(100, 20, 0.25, "partial"), steps: [usage(100, 20, 0.25), unknownUsage],
  })),
  { name: "conflicting aliases retain greatest facts without summing checkpoints", raw: {
    totalCostUsd: 0, costUsd: 0.25,
    steps: [step({ inputTokens: 0, outputTokens: 0, totalCostUsd: 0, costUsd: 0.12,
      output: { inputTokens: 70, outputTokens: 11, totalCostUsd: 0.1, costUsd: 0.15 } })],
  }, run: usage(70, 11, 0.25), steps: [usage(70, 11, 0.15)] },
  { name: "nested output retains large token counts and known zero cost", raw: {
    costUsd: 0, steps: [step({ costUsd: 0, output: { inputTokens: 15_268_507, outputTokens: 69_116, totalCostUsd: 0 } })],
  }, run: usage(15_268_507, 69_116, 0), steps: [usage(15_268_507, 69_116, 0)] },
  { name: "missing facts remain unknown", raw: { steps: [step()] }, run: unknownUsage, steps: [unknownUsage] },
])("preserves historical usage: $name", ({ raw, run, steps }) => {
  const normalized = migrated(historical(raw));
  expect(normalized.usage).toEqual(run);
  expect(normalized.steps.map((value) => value.type === "agent" && value.status !== "skipped" ? value.usage : undefined)).toEqual(steps);
  // The current schema rejects leftover legacy aliases; persisted normalization is idempotent.
  expect(normalizeWorkflowRunMetadata(normalized)).toEqual({ kind: "valid", metadata: normalized });
});

it("quarantines malformed terminal history without erasing lineage or valid usage facts", () => {
  expect(normalizeWorkflowRunMetadata(historical({
    definitionPath: 17, inputTokens: 44, outputTokens: 9, totalCostUsd: 0.4,
    retryOf: "run-previous", tags: ["historical", "builder"],
  }))).toMatchObject({ kind: "quarantined", diagnostic: {
    recoveryAction: expect.stringContaining("outside .kota/runs"),
    facts: { id: "run-1", workflow: "builder", status: "success", triggerEvent: "manual",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      retryOf: "run-previous", tags: ["historical", "builder"], usage: usage(44, 9, 0.4) },
  } });
  expect(normalizeWorkflowRunMetadata(historical({ steps: [step({
    usage: { tokens: { state: "complete", inputTokens: 91, outputTokens: 17 }, cost: { state: "complete", usd: "invalid" } },
  })] }))).toMatchObject({ kind: "quarantined", diagnostic: {
    reason: expect.stringContaining("steps.0.usage.cost.usd must be a non-negative finite number"),
    facts: { steps: [{ usage: { tokens: { state: "complete", inputTokens: 91, outputTokens: 17 }, cost: { state: "unknown" } } }] },
  } });
});

it.each([
  ["running", "invalid-authority"], ["waiting", "invalid-authority"],
  ["integrating", "invalid-authority"], [undefined, "invalid-authority"], ["success", "quarantined"],
  ["constructor", "invalid-authority"], ["toString", "invalid-authority"], ["__proto__", "invalid-authority"],
])("classifies malformed status %s by positive terminal evidence", (status, kind) => {
  for (const defect of [{ definitionPath: 17 }, { startedAt: "not-a-timestamp" }]) {
    expect(normalizeWorkflowRunMetadata(historical({ ...defect, status }))).toMatchObject({
      kind, diagnostic: { recoveryAction: expect.stringContaining(kind === "quarantined" ? "outside .kota/runs" : "before restarting or dispatching") },
    });
  }
});

it.each([undefined, WORKFLOW_RUN_METADATA_VERSION, 99])("rejects forged terminal status at the persisted boundary, version=%s", (metadataVersion) => {
  const root = runsDir();
  writeMetadata(root, "run-1", metadata({ metadataVersion, status: "constructor" }));
  expect(() => enumerateWorkflowRunMetadata(root, { authorityCriticalRunIds: new Set(), onDiagnostic: () => {} })).toThrow(WorkflowRunMetadataAuthorityError);
});

it("derives critical and terminal run identities from durable state and pending publication", () => {
  const runs = (["queued", "running", "waiting", "integrating", "needs_attention", "succeeded", "failed", "cancelled"] as const)
    .map((state) => ({ id: state, state }));
  expect([...workflowRunMetadataAuthorityCriticalIds(runs, [{ runId: "succeeded" }, { runId: "publication-only" }])]).toEqual([
    "running", "waiting", "integrating", "needs_attention", "succeeded", "publication-only",
  ]);
  expect([...workflowRunMetadataTerminalIds(runs)]).toEqual(["succeeded", "failed", "cancelled"]);
});

it.each([
  { terminal: false, critical: false }, { terminal: true, critical: false }, { terminal: true, critical: true },
])("requires terminal authority to quarantine invalid JSON: %j", ({ terminal, critical }) => {
  const root = runsDir();
  const path = writeMetadata(root, "run-1");
  writeFileSync(path, "{invalid");
  const warnings: string[] = [];
  const enumerate = () => enumerateWorkflowRunMetadata(root, {
    authorityCriticalRunIds: new Set(critical ? ["run-1"] : []),
    terminalRunIds: new Set(terminal ? ["run-1"] : []), onDiagnostic: (d) => warnings.push(d.reason),
  });
  if (terminal && !critical) {
    expect(enumerate()).toMatchObject({ runs: [], diagnostics: [{ reason: expect.stringContaining("invalid JSON") }] });
    expect(warnings).toHaveLength(1);
  } else expect(enumerate).toThrow(WorkflowRunMetadataAuthorityError);
  expect(readFileSync(path, "utf8")).toBe("{invalid");
});

it("distinguishes absent stores from unreadable stores", () => {
  const root = runsDir();
  expect(enumerateWorkflowRunMetadata(join(root, "absent"), { authorityCriticalRunIds: new Set() })).toEqual({ runs: [], diagnostics: [] });
  const file = join(root, "not-a-directory");
  writeFileSync(file, "not a directory");
  expect(() => enumerateWorkflowRunMetadata(file, { authorityCriticalRunIds: new Set() })).toThrow(WorkflowRunMetadataEnumerationError);
});

it("enumerates valid history and bounds warnings without discarding quarantine diagnostics", () => {
  const root = runsDir();
  mkdirSync(join(root, "fixture-report"));
  writeFileSync(join(root, "fixture-report", "report.json"), "{}");
  writeMetadata(root, "run-1");
  for (const id of ["bad-1", "bad-2", "bad-3"]) writeMetadata(root, id, historical({ id, definitionPath: 17 }));
  const warnings: string[] = [];
  const result = enumerateWorkflowRunMetadata(root, {
    authorityCriticalRunIds: new Set(), maxWarnings: 1, onDiagnostic: (d) => warnings.push(d.reason),
  });
  expect(result.runs.map((run) => run.id)).toEqual(["run-1"]);
  expect(result.diagnostics).toHaveLength(3);
  expect(warnings).toEqual([result.diagnostics[0]?.reason, expect.stringContaining("2 additional")]);
});

it.each(["running", "success"])("rejects malformed authority metadata even with evidence status %s", (status) => {
  const root = runsDir();
  const path = writeMetadata(root, "run-1", historical({ status, definitionPath: 17 }));
  expect(() => enumerateWorkflowRunMetadata(root, { authorityCriticalRunIds: new Set(["run-1"]) })).toThrow(WorkflowRunMetadataAuthorityError);
  expect(() => readWorkflowRunMetadataFile(path, { authorityCritical: true })).toThrow(WorkflowRunMetadataAuthorityError);
});

it.each(["absent-store", "absent-run", "absent-file"])("fails closed on missing authority metadata: %s", (absence) => {
  let root = runsDir();
  if (absence === "absent-store") root = join(root, "missing");
  if (absence === "absent-file") mkdirSync(join(root, "run-1"));
  const path = join(root, "run-1", "metadata.json");
  expect(() => readWorkflowRunMetadataFile(path, { authorityCritical: true })).toThrow("metadata file is missing");
  expect(() => enumerateWorkflowRunMetadata(root, { authorityCriticalRunIds: new Set(["run-1"]) })).toThrow("metadata file is missing");
  expect(readWorkflowRunMetadataFile(path)).toBeNull();
});

it.each(["other-run", "unsafe directory"])("binds stored metadata to its safe directory identity: %s", (id) => {
  const root = runsDir();
  const path = writeMetadata(root, id);
  expect(() => readWorkflowRunMetadataFile(path)).toThrow(WorkflowRunMetadataAuthorityError);
  expect(enumerateWorkflowRunMetadata(root, { authorityCriticalRunIds: new Set(), onDiagnostic: () => {} })).toMatchObject({
    runs: [], diagnostics: [{ reason: expect.stringContaining(id === "other-run" ? "does not match directory" : "must be a path-safe segment") }],
  });
});

it.each([true, false])("accepts finalized execution evidence while publication retains authority; active=%s", (active) => {
  const root = runsDir();
  const path = writeMetadata(root, "run-1");
  expect(readWorkflowRunMetadataFile(path, { authorityCritical: true, operationallyActive: active }).status).toBe("success");
  expect(enumerateWorkflowRunMetadata(root, {
    authorityCriticalRunIds: new Set(["run-1"]), operationallyActiveRunIds: new Set(active ? ["run-1"] : []),
  }).runs.map((run) => run.id)).toEqual(["run-1"]);
});

it("returns normalized historical reads without rewriting the source record", () => {
  const root = runsDir();
  const path = writeMetadata(root, "run-1", historical({ totalCostUsd: 0, inputTokens: 5, outputTokens: 2, steps: [] }));
  const before = readFileSync(path, "utf8");
  expect(readWorkflowRunMetadataFile(path)).toMatchObject({ metadataVersion: WORKFLOW_RUN_METADATA_VERSION, usage: usage(5, 2, 0) });
  expect(readFileSync(path, "utf8")).toBe(before);
});
