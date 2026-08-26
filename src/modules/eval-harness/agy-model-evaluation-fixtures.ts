import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { AgyInstructionTraceRule } from "./agy-model-evaluation-types.js";
import { AGY_MODEL_EVALUATION_SCENARIOS } from "./agy-model-evaluation-types.js";
import type { LoadedFixture } from "./fixture.js";

export function validateAgyScenarioFixtures(
  workspaceRoot: string,
  fixtures: readonly LoadedFixture[],
): void {
  for (const fixture of fixtures) {
    const scenario = AGY_MODEL_EVALUATION_SCENARIOS.find(
      (entry) => entry.fixtureId === fixture.spec.id,
    );
    if (scenario === undefined) {
      throw new Error(
        `AGY fixture "${fixture.spec.id}" has no scenario instruction policy.`,
      );
    }
    if (fixture.spec.mode !== "single-workflow") {
      throw new Error(
        `AGY scenario fixture "${fixture.spec.id}" must be single-workflow.`,
      );
    }
    const scopePredicates = fixture.spec.predicates.filter(
      (predicate) => predicate.kind === "git-changes-within",
    );
    if (scopePredicates.length !== 1) {
      throw new Error(
        `AGY scenario fixture "${fixture.spec.id}" must declare exactly one ` +
          `git-changes-within predicate; observed ${scopePredicates.length}.`,
      );
    }
    validateInstructionSources(workspaceRoot, fixture, scenario.instructionTraceRules);
  }
}

function validateInstructionSources(
  workspaceRoot: string,
  fixture: LoadedFixture,
  rules: readonly AgyInstructionTraceRule[],
): void {
  for (const rule of rules) {
    const sourceRoot =
      rule.sourceRoot === "fixture-initial-state"
        ? fixture.initialStateDir
        : workspaceRoot;
    const sourcePath = resolve(sourceRoot, rule.sourcePath);
    const relativeSource = relative(sourceRoot, sourcePath);
    if (
      relativeSource === "" ||
      relativeSource.startsWith("..") ||
      resolve(sourceRoot, relativeSource) !== sourcePath
    ) {
      throw new Error(`AGY instruction source escaped its root: ${rule.sourcePath}.`);
    }
    let source: string;
    try {
      source = readFileSync(sourcePath, "utf8");
    } catch (error) {
      throw new Error(
        `AGY instruction source "${rule.sourcePath}" for fixture ` +
          `"${fixture.spec.id}" could not be read: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const sourceNeedle = rule.sourceNeedle ?? rule.command;
    if (!source.includes(sourceNeedle)) {
      throw new Error(
        `AGY instruction trace source text "${sourceNeedle}" is not present in ` +
          `${rule.sourceRoot} source "${rule.sourcePath}".`,
      );
    }
  }
}
