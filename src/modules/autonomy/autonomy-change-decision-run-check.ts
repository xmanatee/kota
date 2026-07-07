import { join } from "node:path";
import { readAutonomyChangeDecisionArtifact } from "./autonomy-change-decision-artifact.js";
import { detectMaterialAutonomyChangeRequirement } from "./autonomy-change-decision-classification.js";
import {
  AUTONOMY_CHANGE_DECISION_ARTIFACT,
  AUTONOMY_CHANGE_DECISION_CHECK_ID,
} from "./autonomy-change-decision-types.js";
import { readStagedDiff } from "./staged-diff.js";

export function checkAutonomyChangeDecisionForRun(
  projectDir: string,
  runDirPath: string,
): string {
  const requirement = detectMaterialAutonomyChangeRequirement(
    readStagedDiff(projectDir, ["."]),
  );
  if (!requirement.required) {
    return "OK: no staged material autonomy behavior changes require an autonomy-change decision";
  }

  const artifactPath = join(runDirPath, AUTONOMY_CHANGE_DECISION_ARTIFACT);
  const read = readAutonomyChangeDecisionArtifact(artifactPath);
  if (read.kind === "missing") {
    throw new Error(
      `${AUTONOMY_CHANGE_DECISION_CHECK_ID}: staged material autonomy changes require ${AUTONOMY_CHANGE_DECISION_ARTIFACT}; ` +
        `classes=${requirement.changeClasses.join(",")} files=${requirement.changedFiles.join(",")}`,
    );
  }
  if (read.kind === "invalid") {
    throw new Error(
      `${AUTONOMY_CHANGE_DECISION_CHECK_ID}: malformed ${AUTONOMY_CHANGE_DECISION_ARTIFACT}: ${read.reason}`,
    );
  }
  const missingClasses = requirement.changeClasses.filter(
    (changeClass) => !read.artifact.changeClasses.includes(changeClass),
  );
  if (missingClasses.length > 0) {
    throw new Error(
      `${AUTONOMY_CHANGE_DECISION_CHECK_ID}: ${AUTONOMY_CHANGE_DECISION_ARTIFACT} does not cover staged change classes: ${missingClasses.join(",")}`,
    );
  }
  return (
    `OK: ${AUTONOMY_CHANGE_DECISION_ARTIFACT} covers ` +
    `${requirement.changedFiles.length} material autonomy file(s)`
  );
}
