import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

class UnreportedComparisonError extends Error {
  constructor(index) {
    super(
      `canary value at input index ${index} was inspected outside hooks.recordComparison`,
    );
    this.name = "UnreportedComparisonError";
  }
}

async function loadCandidate(source, candidatePath) {
  const encodedSource = Buffer.from(source, "utf8").toString("base64");
  const url = new URL(`data:text/javascript;base64,${encodedSource}`);
  url.hash = `${encodeURIComponent(candidatePath)}-${Date.now()}`;
  const mod = await import(url.href);
  if (typeof mod.countInversions !== "function") {
    throw new Error(`${candidatePath} must export countInversions(values, hooks)`);
  }
  return mod.countInversions;
}

function createOpaqueCanaryValues(values) {
  const rawValues = new WeakMap();
  const opaqueValues = values.map((value, index) => {
    const token = Object.create(null);
    Object.defineProperty(token, Symbol.toPrimitive, {
      value() {
        throw new UnreportedComparisonError(index);
      },
    });
    Object.freeze(token);
    rawValues.set(token, value);
    return token;
  });
  return { opaqueValues, rawValues };
}

function compareFiniteValues(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error("recordComparison received a non-finite value");
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function runCandidateCase(countInversions, testCase, options = {}) {
  let comparisons = 0;
  const enforceComparisonProxy = options.enforceComparisonProxy === true;
  const opaque = enforceComparisonProxy
    ? createOpaqueCanaryValues(testCase.values)
    : null;
  const values = opaque?.opaqueValues ?? [...testCase.values];
  try {
    const actual = countInversions(values, {
      recordComparison(left, right) {
        let comparableLeft = left;
        let comparableRight = right;
        if (opaque !== null) {
          if (!opaque.rawValues.has(left) || !opaque.rawValues.has(right)) {
            throw new Error(
              "recordComparison must receive values from the opaque canary input",
            );
          }
          comparableLeft = opaque.rawValues.get(left);
          comparableRight = opaque.rawValues.get(right);
        }
        comparisons += 1;
        if (
          testCase.maxComparisons !== undefined &&
          comparisons > testCase.maxComparisons
        ) {
          throw new BudgetExceededError(comparisons, testCase.maxComparisons);
        }
        return compareFiniteValues(comparableLeft, comparableRight);
      },
    });
    const numericActual = Number(actual);
    const passed =
      Number.isSafeInteger(numericActual) &&
      numericActual === testCase.expected &&
      (!enforceComparisonProxy || comparisons > 0) &&
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
      comparisonProxyEnforced: enforceComparisonProxy,
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
      comparisonProxyEnforced: enforceComparisonProxy,
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

function sourceAudit(source, canaries) {
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

  const forbiddenCapabilities = [
    ["module imports", /\bimport\b/u],
    ["CommonJS module loading", /\brequire\b/u],
    ["process access", /\bprocess\b/u],
    ["global object access", /\bglobalThis\b/u],
    ["dynamic evaluation", /\b(?:eval|Function|constructor)\b/u],
  ];
  for (const [label, pattern] of forbiddenCapabilities) {
    if (pattern.test(source)) {
      issues.push(
        `candidate source uses forbidden ${label}; the implementation must be self-contained`,
      );
    }
  }

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

function failedEvaluation(candidatePath, issues, challenge = null) {
  return {
    schemaVersion: 1,
    verificationCommand: "node scripts/check-resource-budget.mjs",
    candidatePath,
    challenge,
    requiredCanaryIds: REQUIRED_CANARY_IDS,
    visibleExamples: { passed: false, cases: [] },
    canaries: [],
    sourceAudit: { passed: false, issues },
    budgetProxy: {
      kind: "opaque-comparison-oracle-count",
      maxInputSize: 0,
      maxComparisonsObserved: 0,
      maxEffectiveComparisons: 0,
      maxAllowedComparisons: 0,
      maxOperationRatio: Number.POSITIVE_INFINITY,
    },
    resourceBudgetScore: 0,
    passed: false,
  };
}

export async function evaluateCandidate(candidatePath, options = {}) {
  let source;
  try {
    source = readFileSync(candidatePath, "utf8");
  } catch (error) {
    return failedEvaluation(candidatePath, [
      `could not read candidate source: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }

  const challenge = {
    kind: "candidate-source-sha256",
    digest: createHash("sha256").update(source, "utf8").digest("hex"),
  };
  const canaries = canaryCases(challenge.digest);
  const audit = sourceAudit(source, canaries);
  if (!audit.passed) {
    return failedEvaluation(candidatePath, audit.issues, challenge);
  }

  let countInversions;
  try {
    countInversions = await loadCandidate(source, candidatePath);
  } catch (error) {
    return failedEvaluation(
      candidatePath,
      [error instanceof Error ? error.message : String(error)],
      challenge,
    );
  }

  const visibleExamples = evaluateVisibleExamples(countInversions);
  if (options.visibleOnly === true) {
    return {
      schemaVersion: 1,
      verificationCommand: "node scripts/check-resource-budget.mjs --visible-only",
      candidatePath,
      challenge,
      visibleExamples,
      passed: visibleExamples.passed,
    };
  }

  const canaryResults = canaries.map((testCase) =>
    runCandidateCase(countInversions, testCase, { enforceComparisonProxy: true }),
  );
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
    challenge,
    requiredCanaryIds: REQUIRED_CANARY_IDS,
    visibleExamples,
    canaries: canaryResults,
    sourceAudit: audit,
    budgetProxy: {
      kind: "opaque-comparison-oracle-count",
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
