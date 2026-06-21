
import { FIXTURE_CONTROL_DECISIONS, type FixtureControlDecision, type FixtureJsonValue, type FixtureProvenance } from "./fixture-common-types.js";
import { FixtureProvenanceError } from "./fixture-errors.js";
import { isJsonObject } from "./fixture-parse-utils.js";

export function parseProvenance(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): FixtureProvenance {
  if (!isJsonObject(raw)) {
    throw new FixtureProvenanceError(
      fixtureDir,
      "missing provenance object. Every fixture must declare provenance as either a real-failure fixture (with a source run id) or a justified smoke fixture.",
    );
  }
  switch (raw.kind) {
    case "real-failure": {
      if (typeof raw.sourceRunId !== "string" || raw.sourceRunId.length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'real-failure provenance must include a non-empty "sourceRunId" pointing at a .kota/runs/ id.',
        );
      }
      return { kind: "real-failure", sourceRunId: raw.sourceRunId };
    }
    case "smoke-fixture": {
      if (typeof raw.justification !== "string" || raw.justification.trim().length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'smoke-fixture provenance must include a non-empty "justification" explaining why no failure mode is encoded.',
        );
      }
      return { kind: "smoke-fixture", justification: raw.justification };
    }
    default:
      throw new FixtureProvenanceError(
        fixtureDir,
        `unknown kind ${JSON.stringify(raw.kind)}. Legal shapes are "real-failure" (with sourceRunId) and "smoke-fixture" (with justification).`,
      );
  }
}

function isFixtureControlDecision(value: string): value is FixtureControlDecision {
  return FIXTURE_CONTROL_DECISIONS.some((decision) => decision === value);
}

export function parseControlDecisions(
  raw: readonly FixtureJsonValue[],
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
