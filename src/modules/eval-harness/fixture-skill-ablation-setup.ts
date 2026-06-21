
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FixtureJsonValue } from "./fixture-common-types.js";
import { isJsonObject, isSafeRelativeFixturePath } from "./fixture-parse-utils.js";
import type { VerifierCalibrationSetupOperation } from "./fixture-verifier-types.js";

export function parseSkillAblationSetup(
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
