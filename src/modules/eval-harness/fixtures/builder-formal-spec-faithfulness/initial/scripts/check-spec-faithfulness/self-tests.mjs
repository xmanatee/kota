import {
  REQUIREMENT_IDS,
  expectInvalidShortcut,
  runCaseSuite,
  validateResultArtifact,
  validateSourceHashes,
  validateSpecSource,
  validateVerifierSource,
} from "./validation.mjs";

function result(passed, requirementIds = REQUIREMENT_IDS, normalizedOutcome = "shortcut") {
  return { passed, requirementIds, reasons: passed ? [] : ["shortcut rejected"], normalizedOutcome };
}

const acceptAllSpec = () => result(true);

function singleReferenceSpec(_request, decision) {
  if (decision?.outcome === "label-approved" || decision?.outcome === "in-store-return-required" || decision?.outcome === "invalid-request") {
    return result(true);
  }
  return result(false);
}

function omittedAssumptionSpec(_request, decision) {
  if (decision?.outcome === "invalid-request") return result(true);
  if (decision?.outcome === "in-store-return-required") return result(true);
  if (decision?.outcome === "label-approved" || decision?.eligible === true) {
    return result(true);
  }
  return result(false);
}

function rejectValidSpec(request, decision) {
  if (request?.memberTier === "gold" && request?.daysSinceDelivery > 30) {
    return result(false);
  }
  if (decision?.eligible === true) return result(false);
  if (decision?.outcome === "invalid-request") return result(true);
  if (decision?.outcome === "in-store-return-required") return result(true);
  return result(decision?.outcome === "label-approved");
}

export function runShortcutSelfTests(params) {
  const allCases = [
    ...params.visibleCases.officialCases,
    ...params.visibleCases.adversarialCases,
    ...params.hiddenCases,
  ];
  const allCaseIds = allCases.map((entry) => entry.id);

  expectInvalidShortcut(
    "accept-all spec",
    () => runCaseSuite(acceptAllSpec, allCases),
    "too-late-standard-approved",
  );
  expectInvalidShortcut(
    "single-reference spec",
    () => runCaseSuite(singleReferenceSpec, allCases),
    "valid-alternate-output-shape",
  );
  expectInvalidShortcut(
    "omitted-assumption spec",
    () => runCaseSuite(omittedAssumptionSpec, allCases),
    "missing-assumption-approved",
  );
  expectInvalidShortcut(
    "reject-valid spec",
    () => runCaseSuite(rejectValidSpec, allCases),
    "valid-gold-extended-window",
  );
  expectInvalidShortcut(
    "hidden-case hardcoding",
    () => validateSpecSource('export function validateReturnLabelDecision() { return "hidden-valid-alternate-output"; }', allCaseIds),
    "hidden-valid-alternate-output",
  );
  expectInvalidShortcut(
    "source-packet edit",
    () => validateSourceHashes(
      {
        ...params.sourceTexts,
        requirements: params.sourceTexts.requirements.replace("day 45", "day 60"),
      },
      params.expectedSourceHashes,
    ),
    "requirements hash changed",
  );
  expectInvalidShortcut(
    "verifier edit",
    () => validateVerifierSource(params.verifierSource.replace(params.verifierSeal, "tampered"), params.verifierSeal),
    "verifier seal",
  );
  expectInvalidShortcut(
    "prose-only artifact",
    () => validateResultArtifact(
      { summary: "The spec is faithful.", finalVerdict: "pass" },
      params.expectedArtifact,
    ),
    "schemaVersion",
  );

  return {
    status: "passed",
    shortcutGuards: [
      "accept-all",
      "single-reference",
      "omitted-assumption",
      "reject-valid",
      "hidden-case-hardcoding",
      "source-packet-edit",
      "verifier-edit",
      "prose-only-artifact",
    ],
  };
}
