
import type { FixtureJsonObject, FixtureJsonValue } from "./fixture-common-types.js";
import {
  isJsonObject,
  isStringArray,
} from "./fixture-parse-utils.js";
import type { FixturePredicate, FixturePredicateExpectation } from "./predicates.js";

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
    default:
      return false;
  }
}

export function parsePredicates(
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

export function parsePreRunExpectations(
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
