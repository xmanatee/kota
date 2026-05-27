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
import { join } from "node:path";
import {
  type AgentStepRecording,
  AgentStepRecordingError,
  loadAgentStepRecordings,
  recordingsDirForFixture,
} from "./agent-step-recording.js";
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

export type FixtureSpecFile = {
  /** Stable fixture id; must match the directory name. */
  id: string;
  /** Short human-readable description. */
  description: string;
  /** Autonomy role this fixture scores. */
  role: FixtureAutonomyRole;
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
  triggerPayload?: Record<string, unknown>;
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
   * Optional deterministic numeric objective metrics. Metrics are reported
   * evidence only; pass/fail gating remains exclusively predicate-based.
   */
  objectiveMetrics?: readonly ObjectiveMetricSpec[];
  /**
   * Optional tags operators use to slice the fixture set (e.g. "smoke",
   * "regression-2026-04", "slow"). Not load-bearing — scoring does not read
   * them.
   */
  tags?: readonly string[];
};

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

function isFixturePredicate(value: unknown): value is FixturePredicate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown };
  if (typeof v.kind !== "string") return false;
  const p = v as Record<string, unknown>;
  switch (v.kind) {
    case "file-exists":
    case "file-absent":
      return typeof p.path === "string";
    case "file-contains":
      return typeof p.path === "string" && typeof p.needle === "string";
    case "git-changes-within":
      return isStringArray(p.allowedPaths);
    case "lx12-scientific-claim-result":
      return (
        typeof p.mainPath === "string" &&
        typeof p.holdoutPath === "string" &&
        typeof p.maxErrorPct === "number" &&
        Number.isFinite(p.maxErrorPct) &&
        p.maxErrorPct >= 0
      );
    case "shell-succeeds":
    case "shell-fails":
      return (
        typeof p.command === "string" &&
        (p.timeoutMs === undefined || typeof p.timeoutMs === "number")
      );
    case "run-emits-event":
      return (
        typeof p.event === "string" &&
        (p.workflow === undefined || typeof p.workflow === "string") &&
        (p.payloadMatch === undefined ||
          (typeof p.payloadMatch === "object" &&
            p.payloadMatch !== null &&
            !Array.isArray(p.payloadMatch)))
      );
    case "run-omits-event":
      return (
        typeof p.event === "string" &&
        (p.workflow === undefined || typeof p.workflow === "string")
      );
    case "external-call-log":
      return (
        typeof p.binary === "string" &&
        p.binary.length > 0 &&
        isValidExternalCallMatch(p.match) &&
        (p.exitClass === undefined ||
          p.exitClass === "zero" ||
          p.exitClass === "non-zero")
      );
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
  const r = raw as Record<string, unknown>;
  const requiredStrings: Array<keyof FixtureSpecFile> = [
    "id",
    "description",
    "role",
    "workflowName",
  ];
  for (const key of requiredStrings) {
    if (typeof r[key] !== "string" || (r[key] as string).length === 0) {
      throw new Error(
        `Fixture at "${fixtureDir}" is missing required string field "${key}".`,
      );
    }
  }
  if (typeof r.budgetMs !== "number" || !Number.isFinite(r.budgetMs)) {
    throw new Error(
      `Fixture at "${fixtureDir}" must set a numeric budgetMs; got ${String(r.budgetMs)}.`,
    );
  }
  if (r.budgetMs < MIN_BUDGET_MS || r.budgetMs > MAX_BUDGET_MS) {
    throw new Error(
      `Fixture at "${fixtureDir}" budgetMs=${r.budgetMs} outside [${MIN_BUDGET_MS}, ${MAX_BUDGET_MS}].`,
    );
  }
  if (!Array.isArray(r.predicates) || r.predicates.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" must declare at least one predicate.`,
    );
  }
  const predicates: FixturePredicate[] = [];
  for (const p of r.predicates) {
    if (!isFixturePredicate(p)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid predicate: ${JSON.stringify(p)}`,
      );
    }
    predicates.push(p);
  }
  if (
    !Array.isArray(r.preRunExpectations) ||
    r.preRunExpectations.length === 0
  ) {
    throw new Error(
      `Fixture at "${fixtureDir}" must declare at least one preRunExpectations entry.`,
    );
  }
  const preRunExpectations: FixturePredicateExpectation[] = [];
  for (const expectation of r.preRunExpectations) {
    if (
      typeof expectation !== "object" ||
      expectation === null ||
      Array.isArray(expectation)
    ) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid preRunExpectations entry: ${JSON.stringify(expectation)}`,
      );
    }
    const candidate = expectation as Partial<FixturePredicateExpectation>;
    const predicate = candidate.predicate;
    const expected = candidate.expected;
    if (
      !isFixturePredicate(predicate) ||
      (expected !== "pass" && expected !== "fail")
    ) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid preRunExpectations entry: ${JSON.stringify(expectation)}`,
      );
    }
    preRunExpectations.push({ predicate, expected });
  }
  if (!preRunExpectations.some((expectation) => expectation.expected === "fail")) {
    throw new Error(
      `Fixture at "${fixtureDir}" preRunExpectations must include at least one predicate expected to fail initially.`,
    );
  }
  const tags =
    r.tags === undefined
      ? undefined
      : Array.isArray(r.tags) && r.tags.every((t) => typeof t === "string")
        ? (r.tags as string[])
        : (() => {
            throw new Error(
              `Fixture at "${fixtureDir}" has invalid tags; must be an array of strings.`,
            );
          })();

  let triggerPayload: Record<string, unknown> | undefined;
  if (r.triggerPayload !== undefined) {
    if (
      typeof r.triggerPayload !== "object" ||
      r.triggerPayload === null ||
      Array.isArray(r.triggerPayload)
    ) {
      throw new Error(
        `Fixture at "${fixtureDir}" has invalid triggerPayload; must be a JSON object.`,
      );
    }
    triggerPayload = r.triggerPayload as Record<string, unknown>;
  }

  let externalCallShims: string[] | undefined;
  if (r.externalCallShims !== undefined) {
    if (!isStringArray(r.externalCallShims)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has invalid externalCallShims; must be an array of binary-name strings.`,
      );
    }
    for (const name of r.externalCallShims as string[]) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error(
          `Fixture at "${fixtureDir}" externalCallShims entry ${JSON.stringify(name)} contains characters outside [A-Za-z0-9._-]. Refuse to install a shim with that name.`,
        );
      }
    }
    externalCallShims = r.externalCallShims as string[];
  }

  let objectiveMetrics: ObjectiveMetricSpec[] | undefined;
  if (r.objectiveMetrics !== undefined) {
    if (!Array.isArray(r.objectiveMetrics) || r.objectiveMetrics.length === 0) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Fixture at "${fixtureDir}" has invalid objectiveMetrics; must be a non-empty array when present.`,
      );
    }
    objectiveMetrics = [];
    const names = new Set<string>();
    for (const metric of r.objectiveMetrics) {
      const parsedMetric = parseObjectiveMetricSpec(metric, fixtureDir);
      if (names.has(parsedMetric.name)) {
        throw new ObjectiveMetricValidationError(
          "malformed-declaration",
          `Fixture at "${fixtureDir}" declares duplicate objective metric name "${parsedMetric.name}".`,
          { metricName: parsedMetric.name },
        );
      }
      names.add(parsedMetric.name);
      objectiveMetrics.push(parsedMetric);
    }
  }

  const provenance = parseProvenance(r.provenance, fixtureDir);
  if (!Array.isArray(r.controlDecisions)) {
    throw new Error(
      `Fixture at "${fixtureDir}" has invalid controlDecisions: field must be a non-empty array.`,
    );
  }
  const controlDecisions = parseControlDecisions(r.controlDecisions, fixtureDir);

  return {
    id: r.id as string,
    description: r.description as string,
    role: r.role as FixtureAutonomyRole,
    workflowName: r.workflowName as string,
    budgetMs: r.budgetMs,
    predicates,
    preRunExpectations,
    provenance,
    controlDecisions,
    ...(triggerPayload !== undefined && { triggerPayload }),
    ...(externalCallShims !== undefined && { externalCallShims }),
    ...(objectiveMetrics !== undefined && { objectiveMetrics }),
    ...(tags && { tags }),
  };
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
