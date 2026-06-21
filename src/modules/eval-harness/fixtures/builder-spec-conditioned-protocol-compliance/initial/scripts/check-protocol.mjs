import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  genericCases,
  hardcodedVisibleOnlyHandler,
  specDependentCases,
} from "./check-protocol/cases.mjs";
import {
  expectInvalidShortcut,
  readJson,
  runCases,
  validateArtifact,
  validateImmutableInputs,
} from "./check-protocol/validation.mjs";
import { processProtocolBatch } from "../src/protocol-handler.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const specPath = resolve(projectRoot, "SPEC.md");
const verifierPath = fileURLToPath(import.meta.url);
const artifactPath = resolve(projectRoot, "spec-compliance-result.json");
const implementationPath = resolve(projectRoot, "src/protocol-handler.mjs");
const EXPECTED_SPEC_SHA256 = "ac00243c726cb17607ba028decb53b9b9b7afc3fa4d7a99c0d72005c782d76aa";
const VERIFIER_SEAL = "kota-wep-verifier-v1";
const REQUIRED_CLAUSES = ["WEP-1", "WEP-2", "WEP-3", "WEP-4", "WEP-5"];
const EXPECTED_COMMANDS = [
  "node test/protocol-generic.test.mjs",
  "node scripts/check-protocol.mjs",
  "node scripts/check-protocol.mjs --self-test-shortcuts",
];
const FORBIDDEN_SAMPLE_NEEDLES = [
  "visible-1",
  "bad-payload",
  "end-boundary",
  "Device-7",
  "priority-kept",
];

const validationRules = {
  expectedCommands: EXPECTED_COMMANDS,
  expectedSpecSha256: EXPECTED_SPEC_SHA256,
  forbiddenSampleNeedles: FORBIDDEN_SAMPLE_NEEDLES,
  requiredClauses: REQUIRED_CLAUSES,
  verifierSeal: VERIFIER_SEAL,
};

function buildExpectedArtifactContext(genericNames, specNames) {
  return {
    genericCasesPassed: genericCases.length,
    specDependentCasesPassed: specDependentCases.length,
    genericCaseNames: genericNames,
    specDependentCaseNames: specNames,
    implementationSource: readFileSync(implementationPath, "utf8"),
  };
}

function runShortcutSelfTests() {
  const specText = readFileSync(specPath, "utf8");
  const verifierText = readFileSync(verifierPath, "utf8");
  validateImmutableInputs({ specText, verifierText }, validationRules);

  expectInvalidShortcut(
    "hardcoded visible samples",
    () => runCases("spec-dependent cases", specDependentCases, hardcodedVisibleOnlyHandler),
    "canonical id",
  );

  const goodContext = {
    genericCasesPassed: genericCases.length,
    specDependentCasesPassed: specDependentCases.length,
    genericCaseNames: genericCases.map((entry) => entry.name),
    specDependentCaseNames: specDependentCases.map((entry) => entry.name),
    implementationSource: "export function processProtocolBatch(envelope) { return envelope; }\n",
  };
  const missingClauseArtifact = {
    schemaVersion: 1,
    spec: {
      id: "window-envelope-protocol-v1",
      path: "SPEC.md",
      sha256: EXPECTED_SPEC_SHA256,
      clauseIds: ["WEP-1", "WEP-2", "WEP-3", "WEP-5"],
    },
    verificationCommand: "node scripts/check-protocol.mjs",
    localVerificationCommands: EXPECTED_COMMANDS,
    genericCasesPassed: genericCases.length,
    genericCaseNames: goodContext.genericCaseNames,
    specDependentCasesPassed: specDependentCases.length,
    specDependentCaseNames: goodContext.specDependentCaseNames,
    clauseIdsExercised: ["WEP-1", "WEP-2", "WEP-3", "WEP-5"],
    changedImplementationPaths: ["src/protocol-handler.mjs"],
    provenance: {
      specSource: "SPEC.md",
      localTests: EXPECTED_COMMANDS,
      generatedBy: "local-verifier",
    },
  };
  expectInvalidShortcut(
    "missing clause evidence",
    () => validateArtifact(missingClauseArtifact, goodContext, validationRules),
    "clauseIdsExercised",
  );
  expectInvalidShortcut(
    "spec edit",
    () => validateImmutableInputs({
      specText: specText.replace("end bound is exclusive", "end bound is inclusive"),
      verifierText,
    }, validationRules),
    "SPEC.md hash",
  );
  expectInvalidShortcut(
    "verifier edit",
    () => validateImmutableInputs({
      specText,
      verifierText: verifierText.replace(VERIFIER_SEAL, "tampered-verifier"),
    }, validationRules),
    "verifier seal",
  );

  console.log(JSON.stringify({
    status: "passed",
    shortcutGuards: [
      "hardcoded-visible-samples",
      "missing-clause-evidence",
      "spec-edit",
      "verifier-edit",
    ],
  }, null, 2));
}

function runVerifier() {
  if (!existsSync(artifactPath)) {
    throw new Error("spec-compliance-result.json is missing");
  }
  const specText = readFileSync(specPath, "utf8");
  const verifierText = readFileSync(verifierPath, "utf8");
  validateImmutableInputs({ specText, verifierText }, validationRules);
  const genericNames = runCases("generic cases", genericCases, processProtocolBatch);
  const specNames = runCases("spec-dependent cases", specDependentCases, processProtocolBatch);
  const artifact = readJson(artifactPath);
  const context = buildExpectedArtifactContext(genericNames, specNames);
  validateArtifact(artifact, context, validationRules);
  console.log(JSON.stringify({
    status: "passed",
    genericCasesPassed: genericNames.length,
    specDependentCasesPassed: specNames.length,
    clauseIdsExercised: REQUIRED_CLAUSES,
  }, null, 2));
}

if (process.argv.includes("--self-test-shortcuts")) {
  runShortcutSelfTests();
} else {
  runVerifier();
}
