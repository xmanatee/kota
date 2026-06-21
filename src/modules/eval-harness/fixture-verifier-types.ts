
export const VERIFIER_CALIBRATION_CASE_IDS = [
  "null",
  "golden",
  "adversarial",
] as const;

export type VerifierCalibrationFixedCaseId =
  (typeof VERIFIER_CALIBRATION_CASE_IDS)[number];

export type VerifierCalibrationCaseKind =
  | VerifierCalibrationFixedCaseId
  | "accepted-alternative";

export type VerifierCalibrationSetupOperation = {
  kind: "copy-fixture-file";
  sourcePath: string;
  targetPath: string;
};

export type VerifierCalibrationCaseSpec = {
  id: string;
  caseKind: VerifierCalibrationCaseKind;
  expected: "pass" | "fail";
  setup: readonly VerifierCalibrationSetupOperation[];
};

export type VerifierCalibrationSpec = {
  cases: readonly VerifierCalibrationCaseSpec[];
};
