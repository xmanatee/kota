
import type { FixtureJsonValue } from "./fixture-common-types.js";
import { isJsonObject, parseBudgetMs, parseJsonPayload, parseObjectiveMetrics, parseRequiredString } from "./fixture-parse-utils.js";
import { parsePredicates, parsePreRunExpectations } from "./fixture-predicate-parser.js";
import type { FixtureRoundSpec, FixtureRoundTaskInput } from "./fixture-spec-types.js";

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

export function parseRounds(
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
