import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import {
  evaluatePredicate,
  type FixturePredicate,
  type PredicateEvaluationContext,
} from "./predicates.js";
import { resolveScientificClaimAnalyzerSandbox } from "./scientific-claim-analyzer-sandbox.js";
import { writeFakeContainerBackend } from "./subprocess-executor-test-helpers.js";

const TEST_CONTAINER_DIR = mkdtempSync(join(tmpdir(), "kota-analyzer-runtime-"));
const TEST_CONTAINER = join(TEST_CONTAINER_DIR, "fake-container.mjs");
writeFakeContainerBackend(TEST_CONTAINER);

export const TEST_PREDICATE_CONTEXT: PredicateEvaluationContext = {
  scientificClaimAnalyzerSandbox: resolveScientificClaimAnalyzerSandbox({
    kind: "container",
    executable: TEST_CONTAINER,
    image: "kota-eval:test",
    kotaBinaryPath: "/opt/kota/bin/kota.mjs",
  }),
};

export function cleanupScientificClaimTestContainer(): void {
  rmSync(TEST_CONTAINER_DIR, { recursive: true, force: true });
}

export function writeAndRunAnalyzer(workingDir: string, source: string): void {
  writeFileSync(join(workingDir, "scripts/analyze-claim.mjs"), source);
  for (const [dataPath, outputPath] of [
    ["data/claims/lx12-biomass.csv", "claim-result.json"],
    ["data/claims/lx12-holdout.csv", "claim-holdout-result.json"],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      ["scripts/analyze-claim.mjs", "--data", dataPath, "--output", outputPath],
      { cwd: workingDir, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  }
}

export function evaluateClaimPredicate(
  workingDir: string,
  predicate: FixturePredicate,
) {
  return evaluatePredicate(workingDir, predicate, TEST_PREDICATE_CONTEXT);
}
