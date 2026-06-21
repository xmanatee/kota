
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FixtureJsonValue } from "./fixture-common-types.js";
import { FixtureVerifierCalibrationError } from "./fixture-errors.js";
import { isJsonObject, isSafeRelativeFixturePath } from "./fixture-parse-utils.js";
import {
  VERIFIER_CALIBRATION_CASE_IDS,
  type VerifierCalibrationCaseKind,
  type VerifierCalibrationCaseSpec,
  type VerifierCalibrationFixedCaseId,
  type VerifierCalibrationSetupOperation,
  type VerifierCalibrationSpec,
} from "./fixture-verifier-types.js";

function expectedVerifierCalibrationOutcome(
  caseKind: VerifierCalibrationCaseKind,
): "pass" | "fail" {
  return caseKind === "golden" || caseKind === "accepted-alternative"
    ? "pass"
    : "fail";
}

function parseVerifierCalibrationSetup(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  caseId: string,
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
  caseId: VerifierCalibrationFixedCaseId,
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
    caseKind: caseId,
    expected: expectedVerifierCalibrationOutcome(caseId),
    setup,
  };
}

function parseAcceptedAlternativeCaseId(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  index: number,
  usedIds: Set<string>,
): string {
  if (typeof raw !== "string" || !/^[a-z][a-z0-9-]*$/.test(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `acceptedAlternatives[${index}].id must be a lowercase kebab-case string.`,
    );
  }
  if (usedIds.has(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `acceptedAlternatives[${index}].id "${raw}" duplicates another verifier calibration case id.`,
    );
  }
  usedIds.add(raw);
  return raw;
}

function parseAcceptedAlternativeCase(
  raw: FixtureJsonValue,
  fixtureDir: string,
  index: number,
  usedIds: Set<string>,
): VerifierCalibrationCaseSpec {
  if (!isJsonObject(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `acceptedAlternatives[${index}] must be an object.`,
    );
  }
  const unknownKeys = Object.keys(raw).filter(
    (key) => key !== "id" && key !== "setup",
  );
  if (unknownKeys.length > 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `acceptedAlternatives[${index}] has unknown field(s): ${unknownKeys.join(", ")}.`,
    );
  }
  const id = parseAcceptedAlternativeCaseId(raw.id, fixtureDir, index, usedIds);
  const setup = parseVerifierCalibrationSetup(raw.setup, fixtureDir, id);
  if (setup.length === 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `accepted alternative case "${id}" must declare at least one fixture-owned setup file.`,
    );
  }
  return {
    id,
    caseKind: "accepted-alternative",
    expected: expectedVerifierCalibrationOutcome("accepted-alternative"),
    setup,
  };
}

function parseAcceptedAlternativeCases(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): VerifierCalibrationCaseSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      "acceptedAlternatives must be an array when present.",
    );
  }
  const usedIds = new Set<string>(VERIFIER_CALIBRATION_CASE_IDS);
  return raw.map((entry, index) =>
    parseAcceptedAlternativeCase(entry, fixtureDir, index, usedIds),
  );
}

export function parseVerifierCalibration(
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
  const unknownKeys = Object.keys(raw).filter(
    (key) => !legalCaseIds.has(key) && key !== "acceptedAlternatives",
  );
  if (unknownKeys.length > 0) {
    throw new FixtureVerifierCalibrationError(
      fixtureDir,
      "malformed-declaration",
      `unknown case field(s): ${unknownKeys.join(", ")}.`,
    );
  }
  const acceptedAlternatives = parseAcceptedAlternativeCases(
    raw.acceptedAlternatives,
    fixtureDir,
  );
  return {
    cases: [
      parseVerifierCalibrationCase(raw.null, fixtureDir, "null"),
      parseVerifierCalibrationCase(raw.golden, fixtureDir, "golden"),
      ...acceptedAlternatives,
      parseVerifierCalibrationCase(raw.adversarial, fixtureDir, "adversarial"),
    ],
  };
}
