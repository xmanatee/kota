import {
  type AutonomyHealthSignal,
  normalizeHealthSignal,
} from "./health-signal.js";

export function buildEvaluatorCalibrationDriftHealthSignal(args: {
  runDir: string;
  driftKinds: readonly string[];
  decisionReason: string;
  createdAt: string;
}): AutonomyHealthSignal {
  const driftKey = args.driftKinds
    .map((kind) => kind.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-"))
    .sort()
    .join("-");
  return normalizeHealthSignal({
    source: {
      kind: "workflow",
      id: "evaluator-calibration-monitor",
      workflow: "evaluator-calibration-monitor",
    },
    severity: "warning",
    labels: ["quality", "evaluator-drift"],
    summary: `Evaluator calibration drift detected: ${args.driftKinds.join(", ")}. ${args.decisionReason}`,
    evidenceRefs: [
      {
        kind: "artifact",
        ref: `${args.runDir}/calibration-repair.json`,
        summary: "calibration repair artifact",
      },
    ],
    actionability: "informational",
    dedupeKey: `workflow:evaluator-calibration-monitor:evaluator-drift:${driftKey || "unknown"}`,
    createdAt: args.createdAt,
  });
}
