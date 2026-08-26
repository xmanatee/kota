import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findExpectedTaskReviewTarget,
  findTaskReviewTarget,
  type TaskReviewContract,
} from "#modules/autonomy/task-review-target.js";

function countDoneWhenItems(taskContent: string): number {
  const lines = taskContent.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^## Done When\s*$/.test(line));
  if (headingIndex < 0) return 0;

  let count = 0;
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^##\s+/.test(line) || /^---\s*$/.test(line)) break;
    if (/^\s*-\s+\S/.test(line)) count += 1;
  }
  return count;
}

// A "top-level" criterion/evidence item is a numbered marker at column 0
// (`1.`, `2)`). Bullets (`-`, `*`) are treated as prose/notes so agents can
// add "Design notes" or "Known limitations" sections without inflating the
// criterion count. Six failures in 7d (hjpmjs, vxjzg3, qno619, and three
// earlier) all had the same shape: numbered criteria followed by a notes
// section with column-0 dashes, which the prior regex counted as extra
// criteria and forced evidence-file padding during repair.
function countTopLevelItems(text: string): number {
  return text.split("\n").filter((line) => /^\d+[.)]\s+\S/.test(line)).length;
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

export function checkSuccessCriteriaDeclared(
  runDirPath: string,
  projectDir?: string,
  taskContract?: TaskReviewContract,
): string {
  const filePath = join(runDirPath, "success-criteria.txt");
  if (!existsSync(filePath)) {
    throw new Error(
      "Missing success-criteria.txt in the run directory. " +
        "Before implementing, write a short list of concrete, verifiable " +
        "success conditions to <run-directory>/success-criteria.txt.",
    );
  }
  const content = readFileSync(filePath, "utf8").trim();
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  let minCriteria = 2;
  if (projectDir) {
    const task = taskContract
      ? findExpectedTaskReviewTarget(projectDir, taskContract)
      : findTaskReviewTarget(projectDir, "");
    if (task) {
      const doneWhenCount = countDoneWhenItems(task.content);
      if (doneWhenCount > 0) minCriteria = doneWhenCount;
    }
  }

  if (lines.length < minCriteria) {
    throw new Error(
      `success-criteria.txt must contain at least ${minCriteria} concrete criteria ` +
        `(matching the task's Done When items). Found ${lines.length} non-empty line(s).`,
    );
  }

  return `OK: success-criteria.txt has ${lines.length} criteria (minimum ${minCriteria})`;
}

export function checkSuccessCriteriaVerified(runDirPath: string): string {
  const criteriaPath = join(runDirPath, "success-criteria.txt");
  const verifiedPath = join(runDirPath, "success-criteria-verified.txt");
  if (!existsSync(criteriaPath)) {
    throw new Error("Cannot verify criteria: success-criteria.txt does not exist.");
  }
  if (!existsSync(verifiedPath)) {
    throw new Error(
      "Missing success-criteria-verified.txt in the run directory. " +
        "After implementation, write this file confirming each declared criterion " +
        "is satisfied with evidence.",
    );
  }
  const criteria = readFileSync(criteriaPath, "utf8");
  const verified = readFileSync(verifiedPath, "utf8");

  const criteriaItems = countTopLevelItems(criteria);
  const verifiedItems = countTopLevelItems(verified);
  const useStructured = criteriaItems > 0 || verifiedItems > 0;
  const criteriaCount = useStructured ? criteriaItems : countNonEmptyLines(criteria);
  const verifiedCount = useStructured ? verifiedItems : countNonEmptyLines(verified);
  const unit = useStructured ? "numbered evidence item" : "evidence line";

  if (verifiedCount < criteriaCount) {
    const guidance = useStructured
      ? "Each criterion must be addressed with one numbered evidence item " +
        '(a line starting with "1.", "2.", etc. at column 0). Bullets and ' +
        "prose under a criterion are treated as notes and do not count separately."
      : "Each criterion must be addressed with a corresponding evidence line.";
    throw new Error(
      `success-criteria-verified.txt has ${verifiedCount} ${unit}(s) ` +
        `but success-criteria.txt declares ${criteriaCount} criteria. ${guidance}`,
    );
  }
  return `OK: success criteria verified (${verifiedCount} ${unit}s for ${criteriaCount} criteria)`;
}
