import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const REQUIREMENT_IDS = ["FSF-1", "FSF-2", "FSF-3", "FSF-4", "FSF-5", "FSF-6"];
export const VERIFICATION_COMMAND = "node scripts/check-spec-faithfulness.mjs";
export const LOCAL_VERIFICATION_COMMANDS = [
  "node scripts/check-spec-faithfulness.mjs",
  "node scripts/check-spec-faithfulness.mjs --self-test-shortcuts",
];

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

export function hasAll(actual, expected) {
  const set = new Set(actual);
  return expected.every((entry) => set.has(entry));
}

export function sameMembers(actual, expected) {
  return actual.length === expected.length && hasAll(actual, expected);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateSourceHashes(sourceTexts, expectedHashes) {
  const observed = {
    requirements: sha256(sourceTexts.requirements),
    officialExamples: sha256(sourceTexts.officialExamples),
    adversarialCases: sha256(sourceTexts.adversarialCases),
  };
  const issues = [];
  for (const [key, expected] of Object.entries(expectedHashes)) {
    if (observed[key] !== expected) {
      issues.push(`${key} hash changed`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`source packet changed:\n- ${issues.join("\n- ")}`);
  }
  return observed;
}

export function validateVerifierSource(verifierSource, verifierSeal) {
  const issues = [];
  if (!verifierSource.includes(verifierSeal)) {
    issues.push("verifier seal is missing");
  }
  if (!verifierSource.includes("EXPECTED_SOURCE_HASHES")) {
    issues.push("source hash guard is missing");
  }
  if (!verifierSource.includes("runShortcutSelfTests")) {
    issues.push("shortcut self-test hook is missing");
  }
  if (issues.length > 0) {
    throw new Error(`verifier changed:\n- ${issues.join("\n- ")}`);
  }
}

export function validateSpecSource(specSource, caseIds) {
  const issues = [];
  for (const id of caseIds) {
    if (specSource.includes(id)) {
      issues.push(`spec source hardcodes case id ${id}`);
    }
  }
  if (!specSource.includes("validateReturnLabelDecision")) {
    issues.push("spec source must export validateReturnLabelDecision");
  }
  if (issues.length > 0) {
    throw new Error(`spec source invalid:\n- ${issues.join("\n- ")}`);
  }
}

function normalizeSpecResult(raw, caseId) {
  if (!isRecord(raw)) {
    throw new Error(`${caseId}: spec result must be an object`);
  }
  if (typeof raw.passed !== "boolean") {
    throw new Error(`${caseId}: spec result must include boolean passed`);
  }
  const requirementIds = asStringArray(raw.requirementIds);
  if (requirementIds.length === 0) {
    throw new Error(`${caseId}: spec result must include requirementIds`);
  }
  return {
    passed: raw.passed,
    requirementIds,
    reasons: asStringArray(raw.reasons),
    normalizedOutcome:
      typeof raw.normalizedOutcome === "string" ? raw.normalizedOutcome : "unknown",
  };
}

export function runCaseSuite(validateDecision, cases) {
  const observations = [];
  const failures = [];
  for (const testCase of cases) {
    let result;
    try {
      result = normalizeSpecResult(
        validateDecision(testCase.request, testCase.decision),
        testCase.id,
      );
    } catch (error) {
      failures.push(`${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const shouldPass = testCase.expected === "accept";
    if (result.passed !== shouldPass) {
      failures.push(
        `${testCase.id}: expected ${shouldPass ? "accept" : "reject"} but spec returned ${result.passed ? "accept" : "reject"}`,
      );
    }
    if (!hasAll(result.requirementIds, testCase.requirementIds)) {
      failures.push(
        `${testCase.id}: requirementIds must include ${testCase.requirementIds.join(", ")}`,
      );
    }
    observations.push({
      id: testCase.id,
      expected: testCase.expected,
      passed: result.passed,
      requirementIds: result.requirementIds,
      normalizedOutcome: result.normalizedOutcome,
    });
  }
  if (failures.length > 0) {
    throw new Error(`spec case suite failed:\n- ${failures.join("\n- ")}`);
  }
  return observations;
}

export function validateResultArtifact(artifact, expected) {
  const issues = [];
  if (!isRecord(artifact)) {
    throw new Error("spec-faithfulness-result.json must be a JSON object");
  }
  if (artifact.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }
  if (!sameMembers(asStringArray(artifact.requirementIds), REQUIREMENT_IDS)) {
    issues.push(`requirementIds must contain exactly ${REQUIREMENT_IDS.join(", ")}`);
  }
  if (artifact.specContractPath !== "src/spec-contract.mjs") {
    issues.push("specContractPath must be src/spec-contract.mjs");
  }
  if (artifact.verificationCommand !== VERIFICATION_COMMAND) {
    issues.push(`verificationCommand must be ${JSON.stringify(VERIFICATION_COMMAND)}`);
  }
  if (!hasAll(asStringArray(artifact.localVerificationCommands), LOCAL_VERIFICATION_COMMANDS)) {
    issues.push("localVerificationCommands must include verifier and shortcut self-test commands");
  }
  if (!sameMembers(asStringArray(artifact.acceptedValidCases), expected.acceptedValidCases)) {
    issues.push("acceptedValidCases must exactly match visible accepted cases");
  }
  if (!sameMembers(asStringArray(artifact.rejectedAdversarialCases), expected.rejectedAdversarialCases)) {
    issues.push("rejectedAdversarialCases must exactly match visible rejected adversarial cases");
  }
  if (artifact.finalVerdict !== "pass") {
    issues.push("finalVerdict must be pass");
  }
  const metrics = isRecord(artifact.objectiveMetrics) ? artifact.objectiveMetrics : {};
  if (metrics.validCasesAccepted !== expected.acceptedValidCases.length) {
    issues.push(`objectiveMetrics.validCasesAccepted must be ${expected.acceptedValidCases.length}`);
  }
  if (metrics.adversarialRejections !== expected.rejectedAdversarialCases.length) {
    issues.push(`objectiveMetrics.adversarialRejections must be ${expected.rejectedAdversarialCases.length}`);
  }
  if (metrics.requirementIdsCovered !== REQUIREMENT_IDS.length) {
    issues.push(`objectiveMetrics.requirementIdsCovered must be ${REQUIREMENT_IDS.length}`);
  }
  const sourcePacket = isRecord(artifact.sourcePacket) ? artifact.sourcePacket : {};
  if (sourcePacket.requirementsSha256 !== expected.sourceHashes.requirements) {
    issues.push("sourcePacket.requirementsSha256 must match REQUIREMENTS.md");
  }
  if (sourcePacket.officialExamplesSha256 !== expected.sourceHashes.officialExamples) {
    issues.push("sourcePacket.officialExamplesSha256 must match official examples");
  }
  if (sourcePacket.adversarialCasesSha256 !== expected.sourceHashes.adversarialCases) {
    issues.push("sourcePacket.adversarialCasesSha256 must match adversarial cases");
  }
  if (issues.length > 0) {
    throw new Error(`spec-faithfulness-result.json invalid:\n- ${issues.join("\n- ")}`);
  }
}

export function expectInvalidShortcut(name, fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(
        `${name} failed for the wrong reason. Expected ${JSON.stringify(expectedMessage)} in ${JSON.stringify(message)}`,
      );
    }
    return;
  }
  throw new Error(`${name} unexpectedly passed`);
}
