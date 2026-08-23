import { CALIBRATION_REPAIR_TASK_ID } from "#modules/autonomy/calibration-repair.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";

export const CALIBRATION_TASK_PATH =
  `data/tasks/ready/${CALIBRATION_REPAIR_TASK_ID}.md`;
export const CALIBRATION_FOLLOW_UP_TASK_ID =
  "task-disposition-retained-evaluator-calibration-contrad";

export function calibrationClaim(taskId: string): QueueTaskClaimResult {
  return {
    claimed: true,
    taskId,
    claim: null,
    recoveryStatus: null,
    safeToRetry: false,
    recoveryPath: "new-claim",
    reason: null,
    candidateCount: 1,
    skipped: [],
    activeClaims: [],
  };
}

export function calibrationTaskSnapshot(args: {
  total: number;
  pass: number;
  fail: number;
  absent: number;
  contradictions: number;
}): string {
  const rate = ((args.contradictions / args.pass) * 100).toFixed(1);
  return [
    "---",
    `id: ${CALIBRATION_REPAIR_TASK_ID}`,
    "title: Repair evaluator calibration drift",
    "status: ready",
    "priority: p1",
    "area: autonomy",
    "summary: Repair drift",
    "created_at: 2026-08-13T17:33:29.512Z",
    "updated_at: 2026-08-13T17:33:29.512Z",
    "---",
    "",
    "Drift kind(s): pass-contradiction.",
    "",
    "## Calibration Snapshot",
    "",
    "- Window: 2026-08-06T17:33:19.913Z → 2026-08-13T17:33:19.913Z",
    `- Total runs in window: ${args.total}`,
    `- Pass verdicts: ${args.pass}`,
    "- Pass-with-warnings verdicts: 0",
    `- Fail verdicts: ${args.fail}`,
    `- Absent verdicts: ${args.absent}`,
    `- Pass-contradiction rate: ${rate}% (${args.contradictions} of ${args.pass}); threshold 25.0%.`,
    "- Pass-with-warnings follow-up rate: 0.0% (0 of 0); threshold 75.0%.",
    "",
  ].join("\n");
}
