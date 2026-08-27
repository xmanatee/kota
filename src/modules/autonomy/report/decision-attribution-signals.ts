import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { isOperatorEvidencePath } from "#modules/autonomy/product-evidence.js";
import type { ReviewScrutinyRecord } from "#modules/autonomy/review-scrutiny.js";
import type { AutonomyRunDeliveryEvidence } from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  DecisionHardSuccessSignal,
  DecisionTroubleSignal,
} from "./decision-attribution-types.js";
import type { OwnerInterventionReport } from "./owner-interventions.js";

const VALIDATION_STEP_RE =
  /\b(?:test|typecheck|lint|hygiene|validate|validation|check)\b/i;

export function hardSuccessSignalsForRun(args: {
  run: WorkflowRunMetadata;
  task: RepoTaskFullRecord | null;
  delivery: AutonomyRunDeliveryEvidence | null;
  reviewRecords: readonly ReviewScrutinyRecord[];
  ownerRecords: OwnerInterventionReport["records"];
  productEvidenceRefs: readonly string[];
}): DecisionHardSuccessSignal[] {
  const signals = new Set<DecisionHardSuccessSignal>();
  if (
    args.delivery?.taskId &&
    (args.run.status === "success" || args.run.status === "completed-with-warnings") &&
    (args.task === null || args.task.state === "done")
  ) {
    signals.add("committed-task-completion");
  }
  if (args.run.steps.some((step) => isValidationStep(step) && step.status === "success")) {
    signals.add("passing-validation");
  }
  if (
    args.reviewRecords.some((record) =>
      record.surface === "critic" &&
      (record.decision === "pass" || record.decision === "pass_with_warnings")
    )
  ) {
    signals.add("accepted-critic-verdict");
  }
  if (
    args.ownerRecords.some((record) =>
      record.status === "answered" && record.outcomeBucket === "proposed-option"
    )
  ) {
    signals.add("owner-acceptance");
  }
  if (args.productEvidenceRefs.length > 0) {
    signals.add("rendered-product-evidence");
  }
  return [...signals].sort();
}

export function troubleSignalsForRun(args: {
  run: WorkflowRunMetadata;
  task: RepoTaskFullRecord | null;
  reviewRecords: readonly ReviewScrutinyRecord[];
  ownerRecords: OwnerInterventionReport["records"];
  hardSuccessSignals: readonly DecisionHardSuccessSignal[];
  productEvidenceRefs: readonly string[];
}): DecisionTroubleSignal[] {
  const signals = new Set<DecisionTroubleSignal>();
  if (args.run.status === "failed") signals.add("failed-run");
  if (args.run.status === "interrupted") signals.add("abandoned-work");
  if (args.run.steps.some((step) => isValidationStep(step) && step.status === "failed")) {
    signals.add("failed-tests");
  }
  if (
    args.reviewRecords.some((record) =>
      record.surface === "critic" && record.decision === "fail"
    )
  ) {
    signals.add("failed-critic-verdict");
  }
  if (
    args.ownerRecords.some((record) =>
      record.outcomeBucket === "freeform-correction" ||
      record.outcomeBucket === "setup-action"
    )
  ) {
    signals.add("owner-correction");
  }
  const repairAttempts = args.run.steps.reduce(
    (sum, step) => sum + readRepairIterations(step.output).length,
    0,
  );
  if (repairAttempts > 0) signals.add("repeated-retries");
  if (repairAttempts > 0 && args.run.status === "failed") {
    signals.add("repair-loop-exhaustion");
  }
  const successful =
    args.run.status === "success" || args.run.status === "completed-with-warnings";
  if (successful && args.hardSuccessSignals.length === 0) {
    signals.add("claimed-success-without-hard-evidence");
  }
  return [...signals].sort();
}

export function operatorEvidenceRefs(
  runsDir: string,
  runId: string,
  delivery: AutonomyRunDeliveryEvidence | null,
): string[] {
  const refs = [
    ...runArtifactEvidenceRefs(join(runsDir, runId)).map((ref) => `run:${ref}`),
    ...(delivery?.changedPaths ?? [])
      .filter(isOperatorEvidencePath)
      .map((ref) => `changed:${ref}`),
  ];
  return [...new Set(refs)].sort();
}

export function refsForRun(
  run: WorkflowRunMetadata,
  task: RepoTaskFullRecord | null,
  delivery: AutonomyRunDeliveryEvidence | null,
  productEvidenceRefs: readonly string[],
): string[] {
  const refs = [`run:${run.id}`];
  if (task) refs.push(`task:${task.id}`);
  if (delivery?.publishedHead) refs.push(`commit:${delivery.publishedHead}`);
  refs.push(...productEvidenceRefs);
  return refs;
}

function isValidationStep(step: WorkflowStepResult): boolean {
  return VALIDATION_STEP_RE.test(step.id);
}

function runArtifactEvidenceRefs(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  const refs: string[] = [];
  function visit(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absPath, relPath);
        continue;
      }
      if (entry.isFile() && isOperatorEvidencePath(relPath)) refs.push(relPath);
    }
  }
  visit(runDir, "");
  return refs.sort();
}
