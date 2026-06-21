import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

function hasAll(actual, expected) {
  const set = new Set(actual);
  return expected.every((entry) => set.has(entry));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateImmutableInputs({ specText, verifierText }, rules) {
  const issues = [];
  if (sha256(specText) !== rules.expectedSpecSha256) {
    issues.push("SPEC.md hash does not match the fixture-owned protocol spec");
  }
  if (!verifierText.includes(rules.verifierSeal)) {
    issues.push("verifier seal is missing");
  }
  if (!verifierText.includes("REQUIRED_CLAUSES")) {
    issues.push("verifier clause guard is missing");
  }
  if (issues.length > 0) {
    throw new Error(`immutable verifier input check failed:\n- ${issues.join("\n- ")}`);
  }
}

export function runCases(label, cases, handler) {
  const passed = [];
  const failures = [];
  for (const testCase of cases) {
    try {
      testCase.run(handler);
      passed.push(testCase.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${testCase.name}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${label} failed:\n- ${failures.join("\n- ")}`);
  }
  return passed;
}

export function validateArtifact(artifact, context, rules) {
  const issues = [];
  if (!isRecord(artifact)) {
    throw new Error("spec-compliance-result.json must be a JSON object");
  }
  if (artifact.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }
  if (artifact.verificationCommand !== "node scripts/check-protocol.mjs") {
    issues.push("verificationCommand must name the local verifier command");
  }
  if (artifact.genericCasesPassed !== context.genericCasesPassed) {
    issues.push(`genericCasesPassed must be ${context.genericCasesPassed}`);
  }
  if (artifact.specDependentCasesPassed !== context.specDependentCasesPassed) {
    issues.push(`specDependentCasesPassed must be ${context.specDependentCasesPassed}`);
  }
  if (!hasAll(asStringArray(artifact.clauseIdsExercised), rules.requiredClauses)) {
    issues.push(`clauseIdsExercised must include ${rules.requiredClauses.join(", ")}`);
  }
  if (!hasAll(asStringArray(artifact.genericCaseNames), context.genericCaseNames)) {
    issues.push("genericCaseNames must include every generic verifier case");
  }
  if (!hasAll(asStringArray(artifact.specDependentCaseNames), context.specDependentCaseNames)) {
    issues.push("specDependentCaseNames must include every spec-dependent verifier case");
  }
  if (!hasAll(asStringArray(artifact.localVerificationCommands), rules.expectedCommands)) {
    issues.push("localVerificationCommands must include the generic test, verifier, and shortcut self-test");
  }
  const changedPaths = asStringArray(artifact.changedImplementationPaths);
  if (changedPaths.length !== 1 || changedPaths[0] !== "src/protocol-handler.mjs") {
    issues.push("changedImplementationPaths must be exactly [\"src/protocol-handler.mjs\"]");
  }

  const spec = isRecord(artifact.spec) ? artifact.spec : {};
  if (spec.id !== "window-envelope-protocol-v1") {
    issues.push("spec.id must be window-envelope-protocol-v1");
  }
  if (spec.path !== "SPEC.md") {
    issues.push("spec.path must be SPEC.md");
  }
  if (spec.sha256 !== rules.expectedSpecSha256) {
    issues.push("spec.sha256 must match the fixture spec hash");
  }
  if (!hasAll(asStringArray(spec.clauseIds), rules.requiredClauses)) {
    issues.push("spec.clauseIds must include every normative clause id");
  }

  const provenance = isRecord(artifact.provenance) ? artifact.provenance : {};
  if (provenance.specSource !== "SPEC.md") {
    issues.push("provenance.specSource must be SPEC.md");
  }
  if (provenance.generatedBy !== "local-verifier") {
    issues.push("provenance.generatedBy must be local-verifier");
  }
  if (!hasAll(asStringArray(provenance.localTests), rules.expectedCommands)) {
    issues.push("provenance.localTests must include every local verification command");
  }

  for (const needle of rules.forbiddenSampleNeedles) {
    if (context.implementationSource.includes(needle)) {
      issues.push(`implementation appears to hardcode scorer or visible sample value ${JSON.stringify(needle)}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`spec compliance artifact invalid:\n- ${issues.join("\n- ")}`);
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
