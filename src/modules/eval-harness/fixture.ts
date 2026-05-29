/**
 * Fixture specification for the autonomy eval harness.
 *
 * A fixture is a self-contained directory under `fixtures/<id>/` containing:
 *   - `fixture.json` — the typed `FixtureSpecFile` (this module)
 *   - `initial/` — the initial repo state copied into the isolated run directory
 *
 * Fixtures describe *what the autonomy workflow must make true*, not *how*.
 * Predicates inspect the final repo state; the agent's self-report is never
 * part of the pass/fail signal.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";
import {
  type AgentStepRecording,
  AgentStepRecordingError,
  loadAgentStepRecordings,
  recordingsDirForFixture,
} from "./agent-step-recording.js";
import {
  type CodeHealthDiagnosticsConfig,
  parseCodeHealthDiagnosticsConfig,
} from "./code-health-diagnostics.js";
import {
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
  parseObjectiveMetricSpec,
} from "./objective-metrics.js";
import type {
  FixturePredicate,
  FixturePredicateExpectation,
} from "./predicates.js";

/** The role the fixture is scored against. Matches autonomy workflow names. */
export type FixtureAutonomyRole =
  | "builder"
  | "decomposer"
  | "improver"
  | "inbox-sorter"
  | "explorer"
  | "dispatcher"
  | "pr-reviewer"
  | "attention-digest";

/**
 * Provenance is the loader-enforced answer to "why does this fixture exist?".
 *
 * Exactly two shapes are legal:
 *
 *  - `real-failure` fixtures encode a specific past autonomy failure and must
 *    cite the `.kota/runs/` id that motivated them.
 *  - `smoke-fixture` fixtures prove harness plumbing itself still works and
 *    must state a written justification in place of a source run id.
 *
 * A fixture without one of these shapes is a contribution error — it admits
 * undocumented "fallback" fixtures that reward cosmetic progress instead of
 * gating against real failure modes.
 */
export type FixtureProvenance =
  | { kind: "real-failure"; sourceRunId: string }
  | { kind: "smoke-fixture"; justification: string };

export const VERIFIER_CALIBRATION_CASE_IDS = [
  "null",
  "golden",
  "adversarial",
] as const;

export type VerifierCalibrationCaseId =
  (typeof VERIFIER_CALIBRATION_CASE_IDS)[number];

export type VerifierCalibrationSetupOperation = {
  kind: "copy-fixture-file";
  sourcePath: string;
  targetPath: string;
};

export type VerifierCalibrationCaseSpec = {
  id: VerifierCalibrationCaseId;
  expected: "pass" | "fail";
  setup: readonly VerifierCalibrationSetupOperation[];
};

export type VerifierCalibrationSpec = {
  cases: readonly VerifierCalibrationCaseSpec[];
};

export const FIXTURE_CONTROL_DECISIONS = [
  "act",
  "ask",
  "refuse",
  "stop",
  "confirm",
  "recover",
] as const;

export type FixtureControlDecision = (typeof FIXTURE_CONTROL_DECISIONS)[number];

export type FixtureControlDecisionCounts = {
  act: number;
  ask: number;
  refuse: number;
  stop: number;
  confirm: number;
  recover: number;
};

export type FixtureControlDecisionCoverageWarning = {
  decision: FixtureControlDecision;
  message: string;
};

export type FixtureControlDecisionCoverageSummary = {
  counts: FixtureControlDecisionCounts;
  missingDecisions: readonly FixtureControlDecision[];
  missingDecisionWarnings: readonly FixtureControlDecisionCoverageWarning[];
};

export type FixtureJsonValue =
  | null
  | boolean
  | number
  | string
  | FixtureJsonValue[]
  | FixtureJsonObject;

export type FixtureJsonObject = { [key: string]: FixtureJsonValue };

export type FixtureRoundTaskInput =
  | { kind: "initial-state" }
  | { kind: "copy-fixture-file"; sourcePath: string; targetPath: string }
  | { kind: "trigger-payload"; payload: FixtureJsonObject };

export type FixtureRoundSpec = {
  /** Stable round id, unique within the fixture and ordered by array position. */
  id: string;
  /** The workflow name to invoke for this round. */
  workflowName: string;
  /**
   * Explicit round budget in milliseconds. A timeout in any round stops the
   * multi-round attempt and records the fixture attempt as `timeout`.
   */
  budgetMs: number;
  /** Explicit source of this round's workflow/task input. */
  taskInput: FixtureRoundTaskInput;
  /** Expectations evaluated immediately before this round executes. */
  preRunExpectations: readonly FixturePredicateExpectation[];
  /** Predicates evaluated immediately after this round executes. */
  predicates: readonly FixturePredicate[];
  /** Optional deterministic numeric metrics evaluated after this round. */
  objectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type FixtureSpecCommon = {
  /** Stable fixture id; must match the directory name. */
  id: string;
  /** Short human-readable description. */
  description: string;
  /** Autonomy role this fixture scores. */
  role: FixtureAutonomyRole;
  /**
   * Provenance record validated by the loader. Required on every fixture.
   */
  provenance: FixtureProvenance;
  /**
   * Control-decision behaviors this fixture exercises. Diagnostic metadata
   * only; scoring ignores it.
   */
  controlDecisions: readonly FixtureControlDecision[];
  /**
   * Optional list of external binary names the runner should shadow with a
   * fixture-scoped recording shim (e.g. ["gh"]). Each declared name has a
   * Node-script shim installed under `<workingDir>/.kota/shims/<binary>`,
   * the shim directory is prepended to `PATH` for the subprocess, and the
   * shim records every invocation as a JSONL line under
   * `<workingDir>/.kota/external-calls/<binary>.jsonl` for an
   * `external-call-log` predicate to inspect. Production code paths leave
   * `PATH` untouched. Allowed name characters are `[A-Za-z0-9._-]` so a
   * malformed declaration cannot escape the shim directory.
   */
  externalCallShims?: readonly string[];
  /**
   * Optional tags operators use to slice the fixture set (e.g. "smoke",
   * "regression-2026-04", "slow"). Not load-bearing — scoring does not read
   * them.
   */
  tags?: readonly string[];
  /**
   * Optional deterministic source-tree diagnostics. Fixtures must explicitly
   * name the tracked source globs so generated or vendored files do not skew
   * the measurements.
   */
  codeHealthDiagnostics?: CodeHealthDiagnosticsConfig;
  /**
   * Optional verifier calibration probes for nontrivial scoring paths. Case
   * expectations are fixed: null/adversarial must fail, golden must pass.
   */
  verifierCalibration?: VerifierCalibrationSpec;
};

export type SingleWorkflowFixtureSpecFile = FixtureSpecCommon & {
  mode: "single-workflow";
  /** The workflow name to invoke against the fixture's initial state. */
  workflowName: string;
  /**
   * Explicit per-run budget in milliseconds. Runs that exceed this budget are
   * recorded as `timeout`, not `fail` — a timeout is evidence the harness ran
   * out of time, which is categorically different from a capability miss.
   */
  budgetMs: number;
  /**
   * Predicates evaluated against the final fixture working directory. The
   * fixture passes only when every predicate passes.
   */
  predicates: readonly FixturePredicate[];
  /**
   * Predicate expectations evaluated against the materialized initial state
   * before the workflow executor starts. At least one expectation must require
   * a predicate to fail initially, proving the fixture is not already in a
   * passing state.
   */
  preRunExpectations: readonly FixturePredicateExpectation[];
  /**
   * Provenance record validated by the loader. Required on every fixture.
   */
  provenance: FixtureProvenance;
  /**
   * Control-decision behaviors this fixture exercises. Diagnostic metadata
   * only; scoring ignores it.
   */
  controlDecisions: readonly FixtureControlDecision[];
  /**
   * Optional trigger payload forwarded verbatim to
   * `kota workflow trigger --payload <json>`. Required for workflows whose
   * `trigger.payload` is load-bearing (e.g. decomposer's `runDir`/`runId`).
   * Strict-protocol rule: absence means "no extra payload"; the subprocess
   * must not synthesize defaults.
   */
  triggerPayload?: FixtureJsonObject;
  /**
   * Optional deterministic numeric objective metrics. Metrics are reported
   * evidence only; pass/fail gating remains exclusively predicate-based.
   */
  objectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type MultiRoundFixtureSpecFile = FixtureSpecCommon & {
  mode: "multi-round";
  /** Ordered rounds executed against one preserved working directory. */
  rounds: readonly FixtureRoundSpec[];
  /**
   * Optional final predicates evaluated after the last successful round. Use
   * these for aggregate invariants that should see the complete workspace.
   */
  aggregatePredicates?: readonly FixturePredicate[];
  /**
   * Optional deterministic metrics evaluated after the last successful round
   * and surfaced on the top-level fixture run for aggregate reporting.
   */
  aggregateObjectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type SkillAblationSkillProvenance = "none" | "imported";

export type SkillAblationExpectedOutcome = "pass" | "fail";

export type SkillAblationPromptEvidenceSpec = {
  requiredNeedles?: readonly string[];
  forbiddenNeedles?: readonly string[];
};

export type SkillAblationExpectedDirection = {
  kind: "treatment-passes-control-fails";
  controlVariantId: string;
  treatmentVariantId: string;
  noisyVariantId?: string;
  summary: string;
};

export type SkillAblationVariantSpec = {
  /** Stable id, unique within the fixture and ordered by array position. */
  id: string;
  /** The fixture-local workflow invoked for this variant. */
  workflowName: string;
  /** Agent definition expected to resolve the variant's skill selection. */
  agentName: string;
  /** Agent step id whose prompt input artifact carries skill evidence. */
  agentStepId: string;
  /** Explicit skill names selected by that agent. Empty is the control. */
  selectedSkills: readonly string[];
  /** Provenance class expected for selected skills. */
  skillProvenance: SkillAblationSkillProvenance;
  /** Expected post-run predicate outcome for this variant. */
  expectedOutcome: SkillAblationExpectedOutcome;
  /** Optional fixture-owned files copied into the materialized variant before git init. */
  setup?: readonly VerifierCalibrationSetupOperation[];
  /** Optional trigger payload forwarded verbatim to workflow exec. */
  triggerPayload?: FixtureJsonObject;
  /** Expectations evaluated immediately before this variant executes. */
  preRunExpectations: readonly FixturePredicateExpectation[];
  /** Predicates evaluated immediately after this variant executes. */
  predicates: readonly FixturePredicate[];
  /** Evidence checks against the actual agent-step input artifact. */
  promptEvidence: SkillAblationPromptEvidenceSpec;
};

export type SkillAblationFixtureSpecFile = FixtureSpecCommon & {
  mode: "skill-ablation";
  /**
   * Shared budget for each variant execution. A timeout in any variant is
   * recorded as timeout evidence and fails unless the variant explicitly
   * expected that observable outcome.
   */
  budgetMs: number;
  variants: readonly SkillAblationVariantSpec[];
  expectedDirection: SkillAblationExpectedDirection;
};

export type FixtureSpecFile =
  | SingleWorkflowFixtureSpecFile
  | MultiRoundFixtureSpecFile
  | SkillAblationFixtureSpecFile;

export function isSingleWorkflowFixtureSpec(
  spec: FixtureSpecFile,
): spec is SingleWorkflowFixtureSpecFile {
  return spec.mode === "single-workflow";
}

export function isMultiRoundFixtureSpec(
  spec: FixtureSpecFile,
): spec is MultiRoundFixtureSpecFile {
  return spec.mode === "multi-round";
}

export function isSkillAblationFixtureSpec(
  spec: FixtureSpecFile,
): spec is SkillAblationFixtureSpecFile {
  return spec.mode === "skill-ablation";
}

/**
 * Thrown when a fixture's provenance metadata is missing or does not match
 * one of the two legal shapes. Carries the fixture directory so the CLI and
 * loader callers can point the operator at the broken fixture directly.
 */
export class FixtureProvenanceError extends Error {
  readonly fixtureDir: string;
  constructor(fixtureDir: string, reason: string) {
    super(`Fixture at "${fixtureDir}" has invalid provenance: ${reason}`);
    this.name = "FixtureProvenanceError";
    this.fixtureDir = fixtureDir;
  }
}

export class FixtureVerifierCalibrationError extends Error {
  readonly fixtureDir: string;
  readonly reason: "missing-required" | "malformed-declaration";

  constructor(
    fixtureDir: string,
    reason: "missing-required" | "malformed-declaration",
    detail: string,
  ) {
    super(`Fixture at "${fixtureDir}" has invalid verifierCalibration: ${detail}`);
    this.name = "FixtureVerifierCalibrationError";
    this.fixtureDir = fixtureDir;
    this.reason = reason;
  }
}

/**
 * A fully-loaded fixture with its on-disk paths resolved. Callers pass this
 * to the runner; the loader guarantees every field is correct before handing
 * it off, so the runner does not re-validate.
 */
export type LoadedFixture = {
  spec: FixtureSpecFile;
  /** Absolute path to this fixture's directory under `fixtures/`. */
  fixtureDir: string;
  /** Absolute path to this fixture's `initial/` directory. */
  initialStateDir: string;
  /**
   * Recorded agent-step responses discovered under `<fixtureDir>/recordings/`.
   * Empty when the fixture does not exercise any agent-call path. The loader
   * pre-validates every recording before the runner executes so a malformed
   * or provenance-mismatched recording fails eagerly rather than inside a
   * fixture subprocess.
   */
  agentStepRecordings: readonly AgentStepRecording[];
};

const MAX_BUDGET_MS = 60 * 60 * 1000;
const MIN_BUDGET_MS = 30_000;

type FixturePredicateJson = FixturePredicate & FixtureJsonObject;

function isFixturePredicate(
  value: FixtureJsonValue | undefined,
): value is FixturePredicateJson {
  if (!isJsonObject(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "file-exists":
    case "file-absent":
      return typeof value.path === "string";
    case "file-contains":
      return typeof value.path === "string" && typeof value.needle === "string";
    case "git-changes-within":
      return isStringArray(value.allowedPaths);
    case "lx12-scientific-claim-result":
      return (
        typeof value.mainPath === "string" &&
        typeof value.holdoutPath === "string" &&
        typeof value.maxErrorPct === "number" &&
        Number.isFinite(value.maxErrorPct) &&
        value.maxErrorPct >= 0
      );
    case "shell-succeeds":
    case "shell-fails":
      return (
        typeof value.command === "string" &&
        (value.timeoutMs === undefined || typeof value.timeoutMs === "number")
      );
    case "run-emits-event":
      return (
        typeof value.event === "string" &&
        (value.workflow === undefined || typeof value.workflow === "string") &&
        (value.payloadMatch === undefined || isJsonObject(value.payloadMatch))
      );
    case "run-omits-event":
      return (
        typeof value.event === "string" &&
        (value.workflow === undefined || typeof value.workflow === "string")
      );
    case "external-call-log":
      return (
        typeof value.binary === "string" &&
        value.binary.length > 0 &&
        isValidExternalCallMatch(value.match) &&
        (value.exitClass === undefined ||
          value.exitClass === "zero" ||
          value.exitClass === "non-zero")
      );
    case "environment-state-audit":
      return isValidEnvironmentStateAuditFiles(value.files);
    default:
      return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isValidExternalCallMatch(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "argv-equals":
    case "argv-prefix":
      return isStringArray(v.argv) && (v.argv as string[]).length > 0;
    case "argv-includes":
      return typeof v.arg === "string" && v.arg.length > 0;
    default:
      return false;
  }
}

function isSafeRelativeAuditPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.startsWith("\\")) {
    return false;
  }
  return !path.split(/[\\/]+/).some((segment) => segment === "..");
}

function isSafeRelativeFixturePath(path: string): boolean {
  return isSafeRelativeAuditPath(path);
}

function isValidEnvironmentStateExpectedEffect(
  value: FixtureJsonValue | undefined,
): boolean {
  if (!isJsonObject(value)) return false;
  return (
    isJsonObject(value.match) &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count > 0
  );
}

function isValidEnvironmentStateForbiddenEffect(
  value: FixtureJsonValue | undefined,
): boolean {
  if (!isJsonObject(value)) return false;
  return isJsonObject(value.match);
}

function isValidOptionalEffectArray(
  value: FixtureJsonValue | undefined,
  validator: (entry: FixtureJsonValue | undefined) => boolean,
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.length > 0 && value.every(validator))
  );
}

function isValidEnvironmentStateAuditFile(
  value: FixtureJsonValue | undefined,
): boolean {
  if (!isJsonObject(value)) return false;
  if (typeof value.path !== "string" || !isSafeRelativeAuditPath(value.path)) {
    return false;
  }
  if (value.format !== "json-array" && value.format !== "jsonl") {
    return false;
  }
  if (
    !isValidOptionalEffectArray(
      value.expectedEffects,
      isValidEnvironmentStateExpectedEffect,
    ) ||
    !isValidOptionalEffectArray(
      value.forbiddenEffects,
      isValidEnvironmentStateForbiddenEffect,
    )
  ) {
    return false;
  }
  return value.expectedEffects !== undefined || value.forbiddenEffects !== undefined;
}

function isValidEnvironmentStateAuditFiles(
  value: FixtureJsonValue | undefined,
): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isValidEnvironmentStateAuditFile)
  );
}

function parseProvenance(raw: unknown, fixtureDir: string): FixtureProvenance {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FixtureProvenanceError(
      fixtureDir,
      "missing provenance object. Every fixture must declare provenance as either a real-failure fixture (with a source run id) or a justified smoke fixture.",
    );
  }
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "real-failure": {
      if (typeof r.sourceRunId !== "string" || r.sourceRunId.length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'real-failure provenance must include a non-empty "sourceRunId" pointing at a .kota/runs/ id.',
        );
      }
      return { kind: "real-failure", sourceRunId: r.sourceRunId };
    }
    case "smoke-fixture": {
      if (typeof r.justification !== "string" || r.justification.trim().length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'smoke-fixture provenance must include a non-empty "justification" explaining why no failure mode is encoded.',
        );
      }
      return { kind: "smoke-fixture", justification: r.justification };
    }
    default:
      throw new FixtureProvenanceError(
        fixtureDir,
        `unknown kind ${JSON.stringify(r.kind)}. Legal shapes are "real-failure" (with sourceRunId) and "smoke-fixture" (with justification).`,
      );
  }
}

function isFixtureControlDecision(value: string): value is FixtureControlDecision {
  return FIXTURE_CONTROL_DECISIONS.some((decision) => decision === value);
}

function parseControlDecisions(
  raw: readonly unknown[],
  fixtureDir: string,
): FixtureControlDecision[] {
  if (raw.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" has invalid controlDecisions: field must be a non-empty array.`,
    );
  }
  const decisions: FixtureControlDecision[] = [];
  const seen = new Set<FixtureControlDecision>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !isFixtureControlDecision(entry)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has invalid controlDecisions entry ${JSON.stringify(entry)}. Legal values are ${FIXTURE_CONTROL_DECISIONS.map((decision) => JSON.stringify(decision)).join(", ")}.`,
      );
    }
    if (seen.has(entry)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has duplicate controlDecisions entry "${entry}".`,
      );
    }
    seen.add(entry);
    decisions.push(entry);
  }
  return decisions;
}

function isJsonObject(
  value: FixtureJsonValue | undefined,
): value is FixtureJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequiredString(
  r: FixtureJsonObject,
  key: string,
  fixtureDir: string,
): string {
  const value = r[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" is missing required string field "${key}".`,
    );
  }
  return value;
}

const SAFE_SKILL_ABLATION_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function parseSkillAblationVariantId(
  raw: FixtureJsonObject,
  fixtureDir: string,
  index: number,
): string {
  const id = parseRequiredString(raw, "id", fixtureDir);
  if (
    !SAFE_SKILL_ABLATION_VARIANT_ID.test(id) ||
    id === "." ||
    id === ".." ||
    id.includes("/") ||
    id.includes("\\") ||
    isAbsolute(id) ||
    win32.isAbsolute(id)
  ) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variants[${index}].id must be a safe single path component matching ${SAFE_SKILL_ABLATION_VARIANT_ID}: ${JSON.stringify(id)}.`,
    );
  }
  return id;
}

function parseBudgetMs(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label = "budgetMs",
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" must set a numeric ${label}; got ${String(raw)}.`,
    );
  }
  if (raw < MIN_BUDGET_MS || raw > MAX_BUDGET_MS) {
    throw new Error(
      `Fixture at "${fixtureDir}" ${label}=${raw} outside [${MIN_BUDGET_MS}, ${MAX_BUDGET_MS}].`,
    );
  }
  return raw;
}

function parsePredicates(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label: string,
): FixturePredicate[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" must declare at least one ${label}.`,
    );
  }
  const predicates: FixturePredicate[] = [];
  for (const p of raw) {
    if (!isFixturePredicate(p)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid ${label} entry: ${JSON.stringify(p)}`,
      );
    }
    predicates.push(p);
  }
  return predicates;
}

function parsePreRunExpectations(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label = "preRunExpectations",
): FixturePredicateExpectation[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" must declare at least one ${label} entry.`,
    );
  }
  const preRunExpectations: FixturePredicateExpectation[] = [];
  for (const expectation of raw) {
    if (!isJsonObject(expectation)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid ${label} entry: ${JSON.stringify(expectation)}`,
      );
    }
    const predicate = expectation.predicate;
    const expected = expectation.expected;
    if (
      !isFixturePredicate(predicate) ||
      (expected !== "pass" && expected !== "fail")
    ) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid ${label} entry: ${JSON.stringify(expectation)}`,
      );
    }
    preRunExpectations.push({ predicate, expected });
  }
  if (!preRunExpectations.some((expectation) => expectation.expected === "fail")) {
    throw new Error(
      `Fixture at "${fixtureDir}" ${label} must include at least one predicate expected to fail initially.`,
    );
  }
  return preRunExpectations;
}

function parseOptionalTags(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.every((t) => typeof t === "string")) {
    return raw;
  }
  throw new Error(
    `Fixture at "${fixtureDir}" has invalid tags; must be an array of strings.`,
  );
}

function parseJsonPayload(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label: string,
): FixtureJsonObject | undefined {
  if (raw === undefined) return undefined;
  if (isJsonObject(raw)) return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" has invalid ${label}; must be a JSON object.`,
  );
}

function parseExternalCallShims(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!isStringArray(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" has invalid externalCallShims; must be an array of binary-name strings.`,
    );
  }
  for (const name of raw) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(
        `Fixture at "${fixtureDir}" externalCallShims entry ${JSON.stringify(name)} contains characters outside [A-Za-z0-9._-]. Refuse to install a shim with that name.`,
      );
    }
  }
  return raw;
}

function expectedVerifierCalibrationOutcome(
  id: VerifierCalibrationCaseId,
): "pass" | "fail" {
  return id === "golden" ? "pass" : "fail";
}

function parseVerifierCalibrationSetup(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  caseId: VerifierCalibrationCaseId,
): VerifierCalibrationSetupOperation[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `case "${caseId}" setup must be an array when present.`,
    );
  }
  const operations: VerifierCalibrationSetupOperation[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) {
      throw new FixtureVerifierCalibrationError(
        fixtureDir,
        "malformed-declaration",
        `case "${caseId}" setup entry must be an object: ${JSON.stringify(entry)}.`,
      );
    }
    const unknownKeys = Object.keys(entry).filter(
      (key) => key !== "kind" && key !== "sourcePath" && key !== "targetPath",
    );
    if (unknownKeys.length > 0) {
      throw new FixtureVerifierCalibrationError(
        fixtureDir,
        "malformed-declaration",
        `case "${caseId}" setup entry has unknown field(s): ${unknownKeys.join(", ")}.`,
      );
    }
    if (entry.kind !== "copy-fixture-file") {
      throw new FixtureVerifierCalibrationError(
        fixtureDir,
        "malformed-declaration",
        `case "${caseId}" setup kind must be "copy-fixture-file"; got ${JSON.stringify(entry.kind)}.`,
      );
    }
    if (
      typeof entry.sourcePath !== "string" ||
      !isSafeRelativeFixturePath(entry.sourcePath) ||
      typeof entry.targetPath !== "string" ||
      !isSafeRelativeFixturePath(entry.targetPath)
    ) {
      throw new FixtureVerifierCalibrationError(
        fixtureDir,
        "malformed-declaration",
        `case "${caseId}" copy-fixture-file setup must use safe relative sourcePath and targetPath strings.`,
      );
    }
    const source = join(fixtureDir, entry.sourcePath);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new FixtureVerifierCalibrationError(
        fixtureDir,
        "malformed-declaration",
        `case "${caseId}" sourcePath "${entry.sourcePath}" must reference an existing fixture-owned file.`,
      );
    }
    operations.push({
      kind: "copy-fixture-file",
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
    });
  }
  return operations;
}

function parseVerifierCalibrationCase(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  caseId: VerifierCalibrationCaseId,
): VerifierCalibrationCaseSpec {
  if (!isJsonObject(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `must declare case "${caseId}" as an object.`,
    );
  }
  const unknownKeys = Object.keys(raw).filter((key) => key !== "setup");
  if (unknownKeys.length > 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `case "${caseId}" has unknown field(s): ${unknownKeys.join(", ")}.`,
    );
  }
  const setup = parseVerifierCalibrationSetup(raw.setup, fixtureDir, caseId);
  if (caseId !== "null" && setup.length === 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `case "${caseId}" must declare at least one fixture-owned setup file.`,
    );
  }
  return {
    id: caseId,
    expected: expectedVerifierCalibrationOutcome(caseId),
    setup,
  };
}

function parseVerifierCalibration(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): VerifierCalibrationSpec | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonObject(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      "field must be an object with null, golden, and adversarial cases.",
    );
  }
  const legalCaseIds = new Set<string>(VERIFIER_CALIBRATION_CASE_IDS);
  const unknownKeys = Object.keys(raw).filter((key) => !legalCaseIds.has(key));
  if (unknownKeys.length > 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `unknown case field(s): ${unknownKeys.join(", ")}.`,
    );
  }
  return {
    cases: VERIFIER_CALIBRATION_CASE_IDS.map((caseId) =>
      parseVerifierCalibrationCase(raw[caseId], fixtureDir, caseId),
    ),
  };
}

function parseSkillAblationSetup(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): VerifierCalibrationSetupOperation[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup must be an array when present.`,
    );
  }
  const operations: VerifierCalibrationSetupOperation[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) {
      throw new Error(
        `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup entry must be an object: ${JSON.stringify(entry)}.`,
      );
    }
    const unknownKeys = Object.keys(entry).filter(
      (key) => key !== "kind" && key !== "sourcePath" && key !== "targetPath",
    );
    if (unknownKeys.length > 0) {
      throw new Error(
        `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup entry has unknown field(s): ${unknownKeys.join(", ")}.`,
      );
    }
    if (entry.kind !== "copy-fixture-file") {
      throw new Error(
        `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup kind must be "copy-fixture-file"; got ${JSON.stringify(entry.kind)}.`,
      );
    }
    if (
      typeof entry.sourcePath !== "string" ||
      !isSafeRelativeFixturePath(entry.sourcePath) ||
      typeof entry.targetPath !== "string" ||
      !isSafeRelativeFixturePath(entry.targetPath)
    ) {
      throw new Error(
        `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup must use safe relative sourcePath and targetPath strings.`,
      );
    }
    const source = join(fixtureDir, entry.sourcePath);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(
        `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" setup sourcePath "${entry.sourcePath}" must reference an existing fixture-owned file.`,
      );
    }
    operations.push({
      kind: "copy-fixture-file",
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
    });
  }
  return operations;
}

function parseObjectiveMetrics(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label: string,
): ObjectiveMetricSpec[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ObjectiveMetricValidationError(
      "malformed-declaration",
      `Fixture at "${fixtureDir}" has invalid ${label}; must be a non-empty array when present.`,
    );
  }
  const objectiveMetrics: ObjectiveMetricSpec[] = [];
  const names = new Set<string>();
  for (const metric of raw) {
    const parsedMetric = parseObjectiveMetricSpec(metric, fixtureDir);
    if (names.has(parsedMetric.name)) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Fixture at "${fixtureDir}" declares duplicate objective metric name "${parsedMetric.name}" in ${label}.`,
        { metricName: parsedMetric.name },
      );
    }
    names.add(parsedMetric.name);
    objectiveMetrics.push(parsedMetric);
  }
  return objectiveMetrics;
}

function parseTaskInput(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  roundId: string,
): FixtureRoundTaskInput {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" round "${roundId}" must declare a taskInput object.`,
    );
  }
  switch (raw.kind) {
    case "initial-state":
      return { kind: "initial-state" };
    case "copy-fixture-file": {
      if (
        typeof raw.sourcePath !== "string" ||
        raw.sourcePath.length === 0 ||
        typeof raw.targetPath !== "string" ||
        raw.targetPath.length === 0
      ) {
        throw new Error(
          `Fixture at "${fixtureDir}" round "${roundId}" copy-fixture-file taskInput must declare sourcePath and targetPath strings.`,
        );
      }
      return {
        kind: "copy-fixture-file",
        sourcePath: raw.sourcePath,
        targetPath: raw.targetPath,
      };
    }
    case "trigger-payload": {
      const payload = parseJsonPayload(
        raw.payload,
        fixtureDir,
        `round "${roundId}" taskInput.payload`,
      );
      if (payload === undefined) {
        throw new Error(
          `Fixture at "${fixtureDir}" round "${roundId}" trigger-payload taskInput must declare payload.`,
        );
      }
      return { kind: "trigger-payload", payload };
    }
    default:
      throw new Error(
        `Fixture at "${fixtureDir}" round "${roundId}" has unknown taskInput kind ${JSON.stringify(raw.kind)}.`,
      );
  }
}

function parseRoundSpec(
  raw: FixtureJsonValue,
  fixtureDir: string,
  index: number,
): FixtureRoundSpec {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" rounds[${index}] must be an object.`,
    );
  }
  const id = parseRequiredString(raw, "id", fixtureDir);
  const roundLabel = `round "${id}"`;
  const objectiveMetrics = parseObjectiveMetrics(
    raw.objectiveMetrics,
    fixtureDir,
    `${roundLabel} objectiveMetrics`,
  );
  return {
    id,
    workflowName: parseRequiredString(raw, "workflowName", fixtureDir),
    budgetMs: parseBudgetMs(raw.budgetMs, fixtureDir, `${roundLabel} budgetMs`),
    taskInput: parseTaskInput(raw.taskInput, fixtureDir, id),
    preRunExpectations: parsePreRunExpectations(
      raw.preRunExpectations,
      fixtureDir,
      `${roundLabel} preRunExpectations`,
    ),
    predicates: parsePredicates(
      raw.predicates,
      fixtureDir,
      `${roundLabel} predicate`,
    ),
    ...(objectiveMetrics !== undefined && { objectiveMetrics }),
  };
}

function parseRounds(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): FixtureRoundSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "multi-round" must declare a non-empty rounds array.`,
    );
  }
  const rounds = raw.map((round, index) =>
    parseRoundSpec(round, fixtureDir, index),
  );
  const seen = new Set<string>();
  for (const round of rounds) {
    if (seen.has(round.id)) {
      throw new Error(
        `Fixture at "${fixtureDir}" declares duplicate round id "${round.id}".`,
      );
    }
    seen.add(round.id);
  }
  return rounds;
}

function parseSkillAblationPromptEvidence(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationPromptEvidenceSpec {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" must declare promptEvidence as an object.`,
    );
  }
  const requiredNeedles =
    raw.requiredNeedles === undefined
      ? undefined
      : isStringArray(raw.requiredNeedles)
        ? raw.requiredNeedles
        : null;
  const forbiddenNeedles =
    raw.forbiddenNeedles === undefined
      ? undefined
      : isStringArray(raw.forbiddenNeedles)
        ? raw.forbiddenNeedles
        : null;
  if (requiredNeedles === null || forbiddenNeedles === null) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" promptEvidence needles must be string arrays.`,
    );
  }
  if (
    (requiredNeedles === undefined || requiredNeedles.length === 0) &&
    (forbiddenNeedles === undefined || forbiddenNeedles.length === 0)
  ) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" promptEvidence must declare at least one requiredNeedles or forbiddenNeedles entry.`,
    );
  }
  return {
    ...(requiredNeedles !== undefined && { requiredNeedles }),
    ...(forbiddenNeedles !== undefined && { forbiddenNeedles }),
  };
}

function parseSkillAblationExpectedOutcome(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationExpectedOutcome {
  if (raw === "pass" || raw === "fail") return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" expectedOutcome must be "pass" or "fail".`,
  );
}

function parseSkillAblationSkillProvenance(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationSkillProvenance {
  if (raw === "none" || raw === "imported") return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" skillProvenance must be "none" or "imported".`,
  );
}

function parseSkillAblationVariant(
  raw: FixtureJsonValue,
  fixtureDir: string,
  index: number,
): SkillAblationVariantSpec {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variants[${index}] must be an object.`,
    );
  }
  const id = parseSkillAblationVariantId(raw, fixtureDir, index);
  const selectedSkills = isStringArray(raw.selectedSkills)
    ? raw.selectedSkills
    : null;
  if (selectedSkills === null) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" selectedSkills must be an array of strings.`,
    );
  }
  const skillProvenance = parseSkillAblationSkillProvenance(
    raw.skillProvenance,
    fixtureDir,
    id,
  );
  if (skillProvenance === "none" && selectedSkills.length > 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" uses skillProvenance "none" but selectedSkills is non-empty.`,
    );
  }
  if (skillProvenance === "imported" && selectedSkills.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" uses skillProvenance "imported" but selectedSkills is empty.`,
    );
  }
  const setup = parseSkillAblationSetup(raw.setup, fixtureDir, id);
  const triggerPayload = parseJsonPayload(
    raw.triggerPayload,
    fixtureDir,
    `skill-ablation variant "${id}" triggerPayload`,
  );
  return {
    id,
    workflowName: parseRequiredString(raw, "workflowName", fixtureDir),
    agentName: parseRequiredString(raw, "agentName", fixtureDir),
    agentStepId: parseRequiredString(raw, "agentStepId", fixtureDir),
    selectedSkills,
    skillProvenance,
    expectedOutcome: parseSkillAblationExpectedOutcome(
      raw.expectedOutcome,
      fixtureDir,
      id,
    ),
    ...(setup !== undefined && { setup }),
    ...(triggerPayload !== undefined && { triggerPayload }),
    preRunExpectations: parsePreRunExpectations(
      raw.preRunExpectations,
      fixtureDir,
      `skill-ablation variant "${id}" preRunExpectations`,
    ),
    predicates: parsePredicates(
      raw.predicates,
      fixtureDir,
      `skill-ablation variant "${id}" predicate`,
    ),
    promptEvidence: parseSkillAblationPromptEvidence(
      raw.promptEvidence,
      fixtureDir,
      id,
    ),
  };
}

function parseSkillAblationVariants(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): SkillAblationVariantSpec[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must declare at least two variants.`,
    );
  }
  const variants = raw.map((variant, index) =>
    parseSkillAblationVariant(variant, fixtureDir, index),
  );
  const seen = new Set<string>();
  for (const variant of variants) {
    if (seen.has(variant.id)) {
      throw new Error(
        `Fixture at "${fixtureDir}" declares duplicate skill-ablation variant id "${variant.id}".`,
      );
    }
    seen.add(variant.id);
  }
  if (!variants.some((variant) => variant.selectedSkills.length === 0)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must include a no-skill control variant.`,
    );
  }
  if (!variants.some((variant) => variant.selectedSkills.length > 0)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must include at least one explicit-skill treatment variant.`,
    );
  }
  return variants;
}

function parseSkillAblationExpectedDirection(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variants: readonly SkillAblationVariantSpec[],
): SkillAblationExpectedDirection {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must declare expectedDirection as an object.`,
    );
  }
  if (raw.kind !== "treatment-passes-control-fails") {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.kind must be "treatment-passes-control-fails".`,
    );
  }
  const controlVariantId = parseRequiredString(
    raw,
    "controlVariantId",
    fixtureDir,
  );
  const treatmentVariantId = parseRequiredString(
    raw,
    "treatmentVariantId",
    fixtureDir,
  );
  const noisyVariantId =
    raw.noisyVariantId === undefined
      ? undefined
      : parseRequiredString(raw, "noisyVariantId", fixtureDir);
  const summary = parseRequiredString(raw, "summary", fixtureDir);
  const ids = new Set(variants.map((variant) => variant.id));
  for (const id of [controlVariantId, treatmentVariantId, noisyVariantId]) {
    if (id === undefined || ids.has(id)) continue;
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection references unknown skill-ablation variant "${id}".`,
    );
  }
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  if (controlVariantId === treatmentVariantId) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection must use distinct controlVariantId and treatmentVariantId values.`,
    );
  }
  const control = variantsById.get(controlVariantId);
  if (control === undefined || control.selectedSkills.length !== 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.controlVariantId must reference a no-skill control variant.`,
    );
  }
  const treatment = variantsById.get(treatmentVariantId);
  if (treatment === undefined || treatment.selectedSkills.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.treatmentVariantId must reference an explicit-skill treatment variant.`,
    );
  }
  if (noisyVariantId !== undefined) {
    if (noisyVariantId === controlVariantId || noisyVariantId === treatmentVariantId) {
      throw new Error(
        `Fixture at "${fixtureDir}" expectedDirection.noisyVariantId must be distinct from controlVariantId and treatmentVariantId.`,
      );
    }
    const noisy = variantsById.get(noisyVariantId);
    if (noisy === undefined || noisy.selectedSkills.length === 0) {
      throw new Error(
        `Fixture at "${fixtureDir}" expectedDirection.noisyVariantId must reference an explicit-skill noisy variant.`,
      );
    }
  }
  return {
    kind: "treatment-passes-control-fails",
    controlVariantId,
    treatmentVariantId,
    ...(noisyVariantId !== undefined && { noisyVariantId }),
    summary,
  };
}

function assertNoModeFields(
  r: FixtureJsonObject,
  fixtureDir: string,
  mode: string,
  fields: readonly string[],
): void {
  const present = fields.filter((field) => r[field] !== undefined);
  if (present.length === 0) return;
  throw new Error(
    `Fixture at "${fixtureDir}" mode "${mode}" cannot declare ${present.join(", ")}.`,
  );
}

function parseCommonSpecFields(
  r: FixtureJsonObject,
  fixtureDir: string,
): FixtureSpecCommon {
  const provenance = parseProvenance(r.provenance, fixtureDir);
  if (!Array.isArray(r.controlDecisions)) {
    throw new Error(
      `Fixture at "${fixtureDir}" has invalid controlDecisions: field must be a non-empty array.`,
    );
  }
  const controlDecisions = parseControlDecisions(r.controlDecisions, fixtureDir);
  const externalCallShims = parseExternalCallShims(r.externalCallShims, fixtureDir);
  const tags = parseOptionalTags(r.tags, fixtureDir);
  const codeHealthDiagnostics = parseCodeHealthDiagnosticsConfig(
    r.codeHealthDiagnostics,
    fixtureDir,
  );
  const verifierCalibration = parseVerifierCalibration(
    r.verifierCalibration,
    fixtureDir,
  );
  return {
    id: parseRequiredString(r, "id", fixtureDir),
    description: parseRequiredString(r, "description", fixtureDir),
    role: parseRequiredString(r, "role", fixtureDir) as FixtureAutonomyRole,
    provenance,
    controlDecisions,
    ...(externalCallShims !== undefined && { externalCallShims }),
    ...(tags !== undefined && { tags }),
    ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
    ...(verifierCalibration !== undefined && { verifierCalibration }),
  };
}

export function predicateCanUseVerifierCalibration(
  predicate: FixturePredicate,
): boolean {
  return (
    predicate.kind === "shell-succeeds" ||
    predicate.kind === "shell-fails" ||
    predicate.kind === "lx12-scientific-claim-result"
  );
}

function predicateRequiresVerifierCalibration(
  predicate: FixturePredicate,
): boolean {
  return predicateCanUseVerifierCalibration(predicate);
}

function objectiveMetricsForSpec(spec: FixtureSpecFile): ObjectiveMetricSpec[] {
  if (isSingleWorkflowFixtureSpec(spec)) {
    return [...(spec.objectiveMetrics ?? [])];
  }
  if (isSkillAblationFixtureSpec(spec)) {
    return [];
  }
  return [
    ...spec.rounds.flatMap((round) => round.objectiveMetrics ?? []),
    ...(spec.aggregateObjectiveMetrics ?? []),
  ];
}

function requiredVerifierCalibrationObjectiveMetricsForSpec(
  spec: FixtureSpecFile,
): ObjectiveMetricSpec[] {
  return objectiveMetricsForSpec(spec);
}

function uniquePredicates(predicates: readonly FixturePredicate[]): FixturePredicate[] {
  const seen = new Set<string>();
  const unique: FixturePredicate[] = [];
  for (const predicate of predicates) {
    const key = JSON.stringify(predicate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(predicate);
  }
  return unique;
}

export function verifierCalibrationPredicatesForSpec(
  spec: FixtureSpecFile,
): FixturePredicate[] {
  const predicates = isSingleWorkflowFixtureSpec(spec)
    ? spec.predicates
    : isSkillAblationFixtureSpec(spec)
      ? spec.variants.flatMap((variant) => variant.predicates)
      : [
        ...spec.rounds.flatMap((round) => round.predicates),
        ...(spec.aggregatePredicates ?? []),
      ];
  return uniquePredicates(predicates.filter(predicateCanUseVerifierCalibration));
}

function requiredVerifierCalibrationPredicatesForSpec(
  spec: FixtureSpecFile,
): FixturePredicate[] {
  return verifierCalibrationPredicatesForSpec(spec).filter(
    predicateRequiresVerifierCalibration,
  );
}

function assertRequiredVerifierCalibration(
  spec: FixtureSpecFile,
  fixtureDir: string,
): void {
  const requiredPredicates = requiredVerifierCalibrationPredicatesForSpec(spec);
  const requiredMetrics = requiredVerifierCalibrationObjectiveMetricsForSpec(spec);
  if (
    (requiredPredicates.length === 0 && requiredMetrics.length === 0) ||
    spec.verifierCalibration !== undefined
  ) {
    return;
  }
  const required = [
    ...(requiredPredicates.length > 0
      ? [
          `calibrated predicate kind(s): ${[
            ...new Set(requiredPredicates.map((predicate) => predicate.kind)),
          ].join(", ")}`,
        ]
      : []),
    ...(requiredMetrics.length > 0
      ? [
          `objective metric(s): ${[
            ...new Set(requiredMetrics.map((metric) => metric.name)),
          ].join(", ")}`,
        ]
      : []),
  ];
  throw new FixtureVerifierCalibrationError(
    fixtureDir,
    "missing-required",
    `missing null, golden, and adversarial cases for ${required.join("; ")}.`,
  );
}

function parseFixtureSpec(rawJson: string, fixtureDir: string): FixtureSpecFile {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `Fixture at "${fixtureDir}" has unparseable fixture.json: ${(err as Error).message}`,
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Fixture at "${fixtureDir}" fixture.json must be a JSON object.`);
  }
  const r = raw as FixtureJsonObject;
  const mode = r.mode ?? "single-workflow";
  const common = parseCommonSpecFields(r, fixtureDir);
  if (mode === "multi-round") {
    assertNoModeFields(r, fixtureDir, "multi-round", [
      "workflowName",
      "budgetMs",
      "triggerPayload",
      "predicates",
      "preRunExpectations",
      "objectiveMetrics",
    ]);
    const aggregatePredicates =
      r.aggregatePredicates === undefined
        ? undefined
        : parsePredicates(r.aggregatePredicates, fixtureDir, "aggregatePredicates");
    const aggregateObjectiveMetrics = parseObjectiveMetrics(
      r.aggregateObjectiveMetrics,
      fixtureDir,
      "aggregateObjectiveMetrics",
    );
    const spec: FixtureSpecFile = {
      ...common,
      mode: "multi-round",
      rounds: parseRounds(r.rounds, fixtureDir),
      ...(aggregatePredicates !== undefined && { aggregatePredicates }),
      ...(aggregateObjectiveMetrics !== undefined && { aggregateObjectiveMetrics }),
    };
    assertRequiredVerifierCalibration(spec, fixtureDir);
    return spec;
  }
  if (mode === "skill-ablation") {
    assertNoModeFields(r, fixtureDir, "skill-ablation", [
      "workflowName",
      "triggerPayload",
      "predicates",
      "preRunExpectations",
      "objectiveMetrics",
      "rounds",
      "aggregatePredicates",
      "aggregateObjectiveMetrics",
    ]);
    const variants = parseSkillAblationVariants(r.variants, fixtureDir);
    const spec: FixtureSpecFile = {
      ...common,
      mode: "skill-ablation",
      budgetMs: parseBudgetMs(r.budgetMs, fixtureDir),
      variants,
      expectedDirection: parseSkillAblationExpectedDirection(
        r.expectedDirection,
        fixtureDir,
        variants,
      ),
    };
    assertRequiredVerifierCalibration(spec, fixtureDir);
    return spec;
  }
  if (mode !== "single-workflow") {
    throw new Error(
      `Fixture at "${fixtureDir}" has unknown mode ${JSON.stringify(mode)}. Legal values are "single-workflow", "multi-round", and "skill-ablation".`,
    );
  }
  assertNoModeFields(r, fixtureDir, "single-workflow", [
    "rounds",
    "aggregatePredicates",
    "aggregateObjectiveMetrics",
  ]);
  const triggerPayload = parseJsonPayload(r.triggerPayload, fixtureDir, "triggerPayload");
  const objectiveMetrics = parseObjectiveMetrics(
    r.objectiveMetrics,
    fixtureDir,
    "objectiveMetrics",
  );
  const spec: FixtureSpecFile = {
    ...common,
    mode: "single-workflow",
    workflowName: parseRequiredString(r, "workflowName", fixtureDir),
    budgetMs: parseBudgetMs(r.budgetMs, fixtureDir),
    predicates: parsePredicates(r.predicates, fixtureDir, "predicate"),
    preRunExpectations: parsePreRunExpectations(
      r.preRunExpectations,
      fixtureDir,
    ),
    ...(triggerPayload !== undefined && { triggerPayload }),
    ...(objectiveMetrics !== undefined && { objectiveMetrics }),
  };
  assertRequiredVerifierCalibration(spec, fixtureDir);
  return spec;
}

function emptyControlDecisionCounts(): FixtureControlDecisionCounts {
  return {
    act: 0,
    ask: 0,
    refuse: 0,
    stop: 0,
    confirm: 0,
    recover: 0,
  };
}

export function summarizeControlDecisionCoverage(
  fixtures: readonly LoadedFixture[],
): FixtureControlDecisionCoverageSummary {
  const counts = emptyControlDecisionCounts();
  for (const fixture of fixtures) {
    for (const decision of fixture.spec.controlDecisions) {
      counts[decision] += 1;
    }
  }
  const missingDecisions = FIXTURE_CONTROL_DECISIONS.filter(
    (decision) => counts[decision] === 0,
  );
  return {
    counts,
    missingDecisions,
    missingDecisionWarnings: missingDecisions.map((decision) => ({
      decision,
      message: `No eval fixture declares control decision "${decision}".`,
    })),
  };
}

/**
 * Thrown when a fixture declares real-failure provenance but its agent-step
 * recordings cite a different source run id, or vice versa. Keeps the
 * recording-is-real-evidence invariant loud at load time.
 */
export class FixtureRecordingProvenanceError extends Error {
  readonly fixtureDir: string;
  constructor(fixtureDir: string, reason: string) {
    super(
      `Fixture at "${fixtureDir}" has inconsistent agent-step recording provenance: ${reason}`,
    );
    this.name = "FixtureRecordingProvenanceError";
    this.fixtureDir = fixtureDir;
  }
}

function validateRecordingProvenance(
  fixtureDir: string,
  spec: FixtureSpecFile,
  recordings: readonly AgentStepRecording[],
): void {
  if (recordings.length === 0) return;
  // Real-failure fixtures pin every recording to the same source run id so
  // the recording is provable evidence of a past run rather than a synthesized
  // shape. Smoke fixtures opt out of that pin: they exist to lock harness
  // plumbing for a workflow whose target failure mode has no real-run history
  // yet, and a synthesized recording is the legitimate way to exercise that
  // plumbing. Honesty for smoke fixtures lives in the written
  // `justification`, which the loader already enforces is non-empty; the
  // recording's own `sourceRunId` field (also enforced non-empty by
  // `parseAgentStepRecording`) carries traceability for the recording's
  // origin without forcing a fake "real-failure" claim onto a synthesized
  // shape.
  if (spec.provenance.kind !== "real-failure") return;
  const expected = spec.provenance.sourceRunId;
  for (const recording of recordings) {
    if (recording.sourceRunId !== expected) {
      throw new FixtureRecordingProvenanceError(
        fixtureDir,
        `recording for step "${recording.stepId}" cites sourceRunId "${recording.sourceRunId}" but fixture provenance.sourceRunId is "${expected}".`,
      );
    }
  }
}

/**
 * Load a single fixture by id from the fixtures root. Fails loudly when the
 * directory layout is wrong — silent skips would hide eval coverage gaps.
 */
export function loadFixture(fixturesRoot: string, id: string): LoadedFixture {
  const fixtureDir = join(fixturesRoot, id);
  if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
    throw new Error(`Fixture "${id}" not found under "${fixturesRoot}".`);
  }
  const specPath = join(fixtureDir, "fixture.json");
  if (!existsSync(specPath)) {
    throw new Error(`Fixture "${id}" missing fixture.json at "${specPath}".`);
  }
  const spec = parseFixtureSpec(readFileSync(specPath, "utf-8"), fixtureDir);
  if (spec.id !== id) {
    throw new Error(
      `Fixture directory "${id}" has mismatched fixture.id="${spec.id}".`,
    );
  }
  const initialStateDir = join(fixtureDir, "initial");
  if (!existsSync(initialStateDir) || !statSync(initialStateDir).isDirectory()) {
    throw new Error(
      `Fixture "${id}" missing required initial/ directory at "${initialStateDir}".`,
    );
  }
  let agentStepRecordings: readonly AgentStepRecording[];
  try {
    agentStepRecordings = loadAgentStepRecordings(fixtureDir);
  } catch (err) {
    if (err instanceof AgentStepRecordingError) {
      throw new Error(
        `Fixture "${id}" has invalid agent-step recording (${recordingsDirForFixture(fixtureDir)}): ${err.message}`,
      );
    }
    throw err;
  }
  validateRecordingProvenance(fixtureDir, spec, agentStepRecordings);
  return { spec, fixtureDir, initialStateDir, agentStepRecordings };
}

/**
 * Load every fixture discoverable under the fixtures root. A fixture is any
 * subdirectory containing a fixture.json file; other entries are ignored so
 * operators can keep notes or helpers alongside fixtures without failing
 * discovery.
 */
export function loadAllFixtures(fixturesRoot: string): LoadedFixture[] {
  if (!existsSync(fixturesRoot)) return [];
  const entries = readdirSync(fixturesRoot, { withFileTypes: true });
  const fixtures: LoadedFixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(fixturesRoot, entry.name, "fixture.json");
    if (!existsSync(specPath)) continue;
    fixtures.push(loadFixture(fixturesRoot, entry.name));
  }
  return fixtures.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}
