
import type { FixtureJsonObject, FixtureJsonValue } from "./fixture-common-types.js";
import {
  isJsonObject,
  isSafeRelativeAuditPath,
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

function isValidExternalCallMatch(value: FixtureJsonValue | undefined): boolean {
  if (!isJsonObject(value)) return false;
  switch (value.kind) {
    case "argv-equals":
    case "argv-prefix":
      return isStringArray(value.argv) && value.argv.length > 0;
    case "argv-includes":
      return typeof value.arg === "string" && value.arg.length > 0;
    default:
      return false;
  }
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
