import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  REQUIRED_CANARY_IDS,
  RESULT_PATH,
  canaryCases,
  visibleCases,
} from "./resource-budget-cases.mjs";

class BudgetExceededError extends Error {
  constructor(comparisons, maxComparisons) {
    super(`comparison budget exceeded: ${comparisons} > ${maxComparisons}`);
    this.name = "BudgetExceededError";
    this.comparisons = comparisons;
    this.maxComparisons = maxComparisons;
  }
}

async function loadCandidate(candidatePath) {
  const url = pathToFileURL(resolve(candidatePath));
  url.searchParams.set("cache", `${process.pid}-${Date.now()}`);
  const mod = await import(url.href);
  if (typeof mod.countInversions !== "function") {
    throw new Error(`${candidatePath} must export countInversions(values, hooks)`);
  }
  return mod.countInversions;
}

function runCandidateCase(countInversions, testCase, options = {}) {
  let comparisons = 0;
  const values = [...testCase.values];
  try {
    const actual = countInversions(values, {
      recordComparison(left, right) {
        comparisons += 1;
        if (
          testCase.maxComparisons !== undefined &&
          comparisons > testCase.maxComparisons
        ) {
          throw new BudgetExceededError(comparisons, testCase.maxComparisons);
        }
        if (!Number.isFinite(left) || !Number.isFinite(right)) {
          throw new Error("recordComparison received a non-finite value");
        }
      },
    });
    const numericActual = Number(actual);
    const passed =
      Number.isSafeInteger(numericActual) &&
      numericActual === testCase.expected &&
      (options.requireComparisonProxy !== true || comparisons > 0) &&
      (testCase.maxComparisons === undefined ||
        comparisons <= testCase.maxComparisons);
    return {
      id: testCase.id,
      inputSize: testCase.values.length,
      expected: testCase.expected,
      actual: numericActual,
      comparisons,
      maxComparisons: testCase.maxComparisons ?? null,
      comparisonProxyRecorded: comparisons > 0,
      passed,
    };
  } catch (error) {
    const budgetExceeded = error instanceof BudgetExceededError;
    return {
      id: testCase.id,
      inputSize: testCase.values.length,
      expected: testCase.expected,
      actual: null,
      comparisons,
      maxComparisons: testCase.maxComparisons ?? null,
      comparisonProxyRecorded: comparisons > 0,
      budgetExceeded,
      error: error instanceof Error ? error.message : String(error),
      passed: false,
    };
  }
}

function evaluateVisibleExamples(countInversions) {
  const cases = visibleCases().map((testCase) =>
    runCandidateCase(countInversions, testCase),
  );
  return {
    passed: cases.every((entry) => entry.passed),
    cases,
  };
}

function sourceAudit(candidatePath, canaries) {
  let source = "";
  try {
    source = readFileSync(candidatePath, "utf8");
  } catch (error) {
    return {
      passed: false,
      issues: [
        `could not read candidate source: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const forbiddenNeedles = [
    RESULT_PATH,
    "check-resource-budget",
    "resourceBudgetScore",
    ...REQUIRED_CANARY_IDS,
    ...canaries.map((entry) => String(entry.expected)),
  ];
  const issues = forbiddenNeedles
    .filter((needle) => needle.length > 0 && source.includes(needle))
    .map(
      (needle) =>
        `candidate source contains forbidden shortcut needle ${JSON.stringify(needle)}`,
    );

  return {
    passed: issues.length === 0,
    issues,
  };
}

function effectiveComparisonCount(result) {
  if (result.maxComparisons === null) return result.comparisons;
  if (result.passed) return result.comparisons;
  if (!result.comparisonProxyRecorded) return result.maxComparisons + 1;
  return Math.max(result.comparisons, result.maxComparisons + 1);
}

export async function evaluateCandidate(candidatePath, options = {}) {
  let countInversions;
  try {
    countInversions = await loadCandidate(candidatePath);
  } catch (error) {
    return {
      schemaVersion: 1,
      verificationCommand: "node scripts/check-resource-budget.mjs",
      candidatePath,
      requiredCanaryIds: REQUIRED_CANARY_IDS,
      visibleExamples: { passed: false, cases: [] },
      canaries: [],
      sourceAudit: {
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
      },
      budgetProxy: {
        kind: "comparison-count",
        maxInputSize: 0,
        maxComparisonsObserved: 0,
        maxAllowedComparisons: 0,
        maxOperationRatio: Number.POSITIVE_INFINITY,
      },
      resourceBudgetScore: 0,
      passed: false,
    };
  }

  const visibleExamples = evaluateVisibleExamples(countInversions);
  if (options.visibleOnly === true) {
    return {
      schemaVersion: 1,
      verificationCommand: "node scripts/check-resource-budget.mjs --visible-only",
      candidatePath,
      visibleExamples,
      passed: visibleExamples.passed,
    };
  }

  const canaries = canaryCases();
  const canaryResults = canaries.map((testCase) =>
    runCandidateCase(countInversions, testCase, { requireComparisonProxy: true }),
  );
  const audit = sourceAudit(candidatePath, canaries);
  const passedCanaries = canaryResults.filter((entry) => entry.passed).length;
  const maxComparisonsObserved = Math.max(
    0,
    ...canaryResults.map((entry) => entry.comparisons),
  );
  const maxEffectiveComparisons = Math.max(
    0,
    ...canaryResults.map(effectiveComparisonCount),
  );
  const maxAllowedComparisons = Math.max(
    0,
    ...canaryResults.map((entry) => entry.maxComparisons ?? 0),
  );
  const maxOperationRatio =
    maxAllowedComparisons === 0
      ? Number.POSITIVE_INFINITY
      : Number((maxEffectiveComparisons / maxAllowedComparisons).toFixed(6));
  const resourceBudgetScore = passedCanaries / REQUIRED_CANARY_IDS.length;

  return {
    schemaVersion: 1,
    verificationCommand: "node scripts/check-resource-budget.mjs",
    candidatePath,
    requiredCanaryIds: REQUIRED_CANARY_IDS,
    visibleExamples,
    canaries: canaryResults,
    sourceAudit: audit,
    budgetProxy: {
      kind: "comparison-count",
      maxInputSize: Math.max(0, ...canaryResults.map((entry) => entry.inputSize)),
      maxComparisonsObserved,
      maxEffectiveComparisons,
      maxAllowedComparisons,
      maxOperationRatio,
    },
    resourceBudgetScore,
    passed: visibleExamples.passed && audit.passed && resourceBudgetScore === 1,
  };
}
