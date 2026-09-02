import type { EvaluatorCalibrationContradiction } from "./evaluator-calibration.js";
import {
  type AutonomyHealthSignal,
  normalizeHealthSignal,
} from "./health-signal.js";

function revisionLabel(revision: string | null): string {
  return revision === null ? "revision-unavailable" : revision.slice(0, 12);
}

function contradictionSummary(
  contradiction: EvaluatorCalibrationContradiction,
): string {
  const disposition = contradiction.disposition === null
    ? "disposition=pending"
    : `disposition=${contradiction.disposition.kind} ` +
      `rationale=${contradiction.disposition.rationale}`;
  return (
    `${contradiction.base.runId}@${revisionLabel(contradiction.base.sourceRevision)} ` +
    `-> ${contradiction.later.runId}@${revisionLabel(contradiction.later.sourceRevision)} ` +
    `baseTask=${contradiction.base.taskId ?? "unavailable"} ` +
    `laterTask=${contradiction.later.taskId ?? "unavailable"} ` +
    `laterFailure=${contradiction.laterFailure.verdict}/` +
    `${contradiction.laterFailure.terminalRunStatus} ` +
    `paths=${contradiction.overlappingSourcePaths.join(",")} ${disposition}`
  );
}

function contradictionEvidenceRef(
  contradiction: EvaluatorCalibrationContradiction,
): { kind: "event"; ref: string; summary: string } {
  const baseRevision = contradiction.base.sourceRevision ?? "revision-unavailable";
  const laterRevision = contradiction.later.sourceRevision ?? "revision-unavailable";
  return {
    kind: "event",
    ref:
      `evaluator-calibration.regression.detected#${contradiction.base.runId}@${baseRevision}` +
      `->${contradiction.later.runId}@${laterRevision}`,
    summary: contradictionSummary(contradiction),
  };
}

export function buildEvaluatorCalibrationDriftHealthSignal(args: {
  runDir: string;
  driftKinds: readonly string[];
  decisionReason: string;
  contradictions: readonly EvaluatorCalibrationContradiction[];
  createdAt: string;
}): AutonomyHealthSignal {
  const driftKey = args.driftKinds
    .map((kind) => kind.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-"))
    .sort()
    .join("-");
  return normalizeHealthSignal({
    observation: "present",
    source: {
      kind: "workflow",
      id: "evaluator-calibration-monitor",
      workflow: "evaluator-calibration-monitor",
    },
    severity: "warning",
    labels: ["quality", "evaluator-drift"],
    summary: [
      `Evaluator calibration drift detected: ${args.driftKinds.join(", ")}.`,
      args.decisionReason,
      ...args.contradictions.map(contradictionSummary),
    ].join(" "),
    evidenceRefs: [
      {
        kind: "artifact",
        ref: `${args.runDir}/evaluator-calibration-observation.json`,
        summary: "evaluator calibration observation",
      },
      ...args.contradictions.map(contradictionEvidenceRef),
    ],
    actionability: "informational",
    dedupeKey: `workflow:evaluator-calibration-monitor:evaluator-drift:${driftKey || "unknown"}`,
    observationCount: 1,
    createdAt: args.createdAt,
  });
}
