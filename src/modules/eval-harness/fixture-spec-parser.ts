
import { parseCodeHealthDiagnosticsConfig } from "./code-health-diagnostics.js";
import { assertRequiredVerifierCalibration } from "./fixture-calibration-requirements.js";
import type { FixtureAutonomyRole, FixtureJsonObject, FixtureJsonValue } from "./fixture-common-types.js";
import {
  assertNoModeFields,
  isJsonObject,
  parseBudgetMs,
  parseExternalCallShims,
  parseJsonPayload,
  parseObjectiveMetrics,
  parseOptionalTags,
  parseRequiredString,
} from "./fixture-parse-utils.js";
import { parsePredicates, parsePreRunExpectations } from "./fixture-predicate-parser.js";
import { parseControlDecisions, parseProvenance } from "./fixture-provenance-parser.js";
import { parseRounds } from "./fixture-round-parser.js";
import { parseSkillAblationExpectedDirection, parseSkillAblationVariants } from "./fixture-skill-ablation-parser.js";
import type { FixtureSpecCommon, FixtureSpecFile } from "./fixture-spec-types.js";
import { parseVerifierCalibration } from "./fixture-verifier-parser.js";

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

export function parseFixtureSpec(rawJson: string, fixtureDir: string): FixtureSpecFile {
  let raw: FixtureJsonValue;
  try {
    raw = JSON.parse(rawJson) as FixtureJsonValue;
  } catch (err) {
    throw new Error(
      `Fixture at "${fixtureDir}" has unparseable fixture.json: ${(err as Error).message}`,
    );
  }
  if (!isJsonObject(raw)) {
    throw new Error(`Fixture at "${fixtureDir}" fixture.json must be a JSON object.`);
  }
  const r = raw;
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
