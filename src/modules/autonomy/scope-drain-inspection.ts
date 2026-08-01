import type { ScopeDrainInspectionSource } from "#core/daemon/scope-drain-inspection.js";
import { listTaskClaimInspections } from "./task-claims.js";

export const autonomyScopeDrainInspection: ScopeDrainInspectionSource = {
  inspect: (project) => {
    const claims = listTaskClaimInspections(project.projectDir);
    if (claims.length === 0) return [];
    return [{
      kind: "task_claim",
      source: "autonomy",
      count: claims.length,
      ids: claims.map(({ claim }) => `${claim.taskId}:${claim.runId}`),
      requiredDisposition: "release-or-supersede",
      detail: `${claims.length} task claim(s) must be released or superseded`,
    }];
  },
};
