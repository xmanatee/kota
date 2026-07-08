import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hiddenCases,
  loadVisibleCases,
  visibleAcceptedCaseIds,
  visibleRejectedAdversarialCaseIds,
} from "./check-spec-faithfulness/cases.mjs";
import { runShortcutSelfTests } from "./check-spec-faithfulness/self-tests.mjs";
import {
  REQUIREMENT_IDS,
  LOCAL_VERIFICATION_COMMANDS,
  VERIFICATION_COMMAND,
  readJson,
  runCaseSuite,
  validateResultArtifact,
  validateSourceHashes,
  validateSpecSource,
  validateVerifierSource,
} from "./check-spec-faithfulness/validation.mjs";
import { validateReturnLabelDecision } from "../src/spec-contract.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifierPath = fileURLToPath(import.meta.url);
const resultPath = "spec-faithfulness-result.json";
const verificationPath = "spec-faithfulness-verification.json";
const VERIFIER_SEAL = "kota-formal-spec-faithfulness-verifier-v1";
const EXPECTED_SOURCE_HASHES = {
  requirements: "cbfd91adf422f8fc55e35ab6642475e2de09081188aaef3ca2f4a7e104647e7c",
  officialExamples: "b429f8257d5518a3dfe4bdda6ed629ff30d7d5f19d8f1c1f7a729420a4d29f53",
  adversarialCases: "19422782fd956bab7ecfcf3a32e9fd2c2d280e116f07045f4bf2884fdf4679c4",
};

function readSourceTexts() {
  return {
    requirements: readFileSync(`${projectRoot}/REQUIREMENTS.md`, "utf8"),
    officialExamples: readFileSync(`${projectRoot}/data/official-examples.json`, "utf8"),
    adversarialCases: readFileSync(`${projectRoot}/data/adversarial-cases.json`, "utf8"),
  };
}

function expectedArtifactContext(visibleCases, sourceHashes) {
  const visibleAccepted = visibleAcceptedCaseIds([
    ...visibleCases.officialCases,
    ...visibleCases.adversarialCases,
  ]);
  return {
    acceptedValidCases: visibleAccepted,
    rejectedAdversarialCases: visibleRejectedAdversarialCaseIds(
      visibleCases.adversarialCases,
    ),
    sourceHashes,
  };
}

function buildVerification(observations, expectedArtifact) {
  return {
    schemaVersion: 1,
    status: "passed",
    requirementIds: REQUIREMENT_IDS,
    verificationCommand: VERIFICATION_COMMAND,
    localVerificationCommands: LOCAL_VERIFICATION_COMMANDS,
    acceptedValidCases: expectedArtifact.acceptedValidCases,
    rejectedAdversarialCases: expectedArtifact.rejectedAdversarialCases,
    hiddenCaseIdsExercised: hiddenCases.map((entry) => entry.id),
    objectiveMetrics: {
      validCasesAccepted: expectedArtifact.acceptedValidCases.length,
      adversarialRejections: expectedArtifact.rejectedAdversarialCases.length,
      requirementIdsCovered: REQUIREMENT_IDS.length,
    },
    observations,
  };
}

function loadAndValidateStaticInputs() {
  const sourceTexts = readSourceTexts();
  const sourceHashes = validateSourceHashes(sourceTexts, EXPECTED_SOURCE_HASHES);
  const verifierSource = readFileSync(verifierPath, "utf8");
  validateVerifierSource(verifierSource, VERIFIER_SEAL);
  const visibleCases = loadVisibleCases(projectRoot);
  validateSpecSource(
    readFileSync(`${projectRoot}/src/spec-contract.mjs`, "utf8"),
    [
      ...visibleCases.officialCases,
      ...visibleCases.adversarialCases,
      ...hiddenCases,
    ].map((entry) => entry.id),
  );
  return { sourceTexts, sourceHashes, verifierSource, visibleCases };
}

function runMain() {
  rmSync(`${projectRoot}/${verificationPath}`, { force: true });
  const { sourceHashes, visibleCases } = loadAndValidateStaticInputs();
  if (!existsSync(`${projectRoot}/${resultPath}`)) {
    throw new Error(`${resultPath} is missing`);
  }
  const allCases = [
    ...visibleCases.officialCases,
    ...visibleCases.adversarialCases,
    ...hiddenCases,
  ];
  const observations = runCaseSuite(validateReturnLabelDecision, allCases);
  const expectedArtifact = expectedArtifactContext(visibleCases, sourceHashes);
  validateResultArtifact(readJson(`${projectRoot}/${resultPath}`), expectedArtifact);
  const verification = buildVerification(observations, expectedArtifact);
  writeFileSync(`${projectRoot}/${verificationPath}`, `${JSON.stringify(verification, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "passed",
    acceptedValidCases: verification.acceptedValidCases,
    rejectedAdversarialCases: verification.rejectedAdversarialCases,
    hiddenCaseIdsExercised: verification.hiddenCaseIdsExercised,
    objectiveMetrics: verification.objectiveMetrics,
  }, null, 2));
}

function runSelfTests() {
  const { sourceTexts, sourceHashes, verifierSource, visibleCases } =
    loadAndValidateStaticInputs();
  const expectedArtifact = expectedArtifactContext(visibleCases, sourceHashes);
  const result = runShortcutSelfTests({
    visibleCases,
    hiddenCases,
    sourceTexts,
    expectedSourceHashes: EXPECTED_SOURCE_HASHES,
    verifierSource,
    verifierSeal: VERIFIER_SEAL,
    expectedArtifact,
  });
  console.log(JSON.stringify(result, null, 2));
}

try {
  if (process.argv.includes("--self-test-shortcuts")) {
    runSelfTests();
  } else {
    runMain();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
