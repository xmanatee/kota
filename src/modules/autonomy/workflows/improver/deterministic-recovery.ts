import { join } from "node:path";
import type { DoctorRepairResult } from "#modules/doctor/client.js";
import { runDoctorFixes } from "#modules/doctor/doctor-fixes.js";
import type { AutonomyIssue } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  classifyDaemonControlFileForAudit,
} from "#modules/autonomy/workflows/runtime-health-auditor/daemon-control-health.js";

export const IMPROVER_RECOVERY_ACTIONS = ["doctor.fix"] as const;
export type ImproverRecoveryAction = (typeof IMPROVER_RECOVERY_ACTIONS)[number];

export type DeterministicRecoveryResult = {
  action: ImproverRecoveryAction;
  repairs: DoctorRepairResult[];
  verification: DoctorRepairResult[];
};

const STALE_DAEMON_CONTROL_ROOT_CAUSE =
  "operator-inbox:runtime:daemon-control-stale";
const DAEMON_CONTROL_EVIDENCE_REF = ".kota/daemon-control.json";

function isStaleDaemonControlIssue(issue: AutonomyIssue): boolean {
  return issue.rootCauseKey === STALE_DAEMON_CONTROL_ROOT_CAUSE &&
    issue.evidenceRefs.some((ref) =>
      ref.kind === "artifact" && ref.ref === DAEMON_CONTROL_EVIDENCE_REF
    );
}

function staleDaemonControlConditionCleared(scopeRoot: string): boolean {
  const controlFile = classifyDaemonControlFileForAudit(join(scopeRoot, ".kota"));
  return controlFile.kind === "missing" || controlFile.kind === "fresh";
}

export function verifyDeterministicRecovery(args: {
  scopeRoot: string;
  issue: AutonomyIssue;
  recovery: DeterministicRecoveryResult;
}): boolean {
  return args.recovery.action === "doctor.fix" &&
    isStaleDaemonControlIssue(args.issue) &&
    staleDaemonControlConditionCleared(args.scopeRoot);
}

export function executeDeterministicRecovery(args: {
  scopeRoot: string;
  issue: AutonomyIssue;
  action: ImproverRecoveryAction;
}): DeterministicRecoveryResult {
  if (args.action !== "doctor.fix" || !isStaleDaemonControlIssue(args.issue)) {
    throw new Error(
      `Recovery action ${args.action} is not allowlisted for ${args.issue.rootCauseKey}`,
    );
  }
  const repairs = runDoctorFixes(args.scopeRoot);
  const failed = repairs.find((repair) => repair.action === "manual");
  if (failed) {
    throw new Error(`Doctor recovery requires manual action: ${failed.item}`);
  }
  const repaired = repairs.some((repair) => repair.action === "repaired");
  const verification = repaired ? runDoctorFixes(args.scopeRoot) : repairs;
  const unstable = verification.find((repair) => repair.action !== "skipped");
  if (unstable) {
    throw new Error(`Doctor recovery verification did not settle: ${unstable.item}`);
  }
  const result = { action: args.action, repairs, verification };
  if (!verifyDeterministicRecovery({
    scopeRoot: args.scopeRoot,
    issue: args.issue,
    recovery: result,
  })) {
    throw new Error(
      `Doctor recovery did not clear ${args.issue.rootCauseKey}`,
    );
  }
  return result;
}
