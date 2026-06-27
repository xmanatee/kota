import type {
  HarnessParityMatrixRow,
  HarnessParityMatrixScaffoldEvidence,
  HarnessParityMatrixScaffoldTaskClass,
} from "./client.js";

const SCAFFOLD_HARNESS_MODE = "openai-tools-scaffold";

const EDIT_AND_VERIFY_SCENARIOS = new Set([
  "fix-arithmetic-bug",
  "extract-shared-helper",
  "rename-across-files",
  "revise-from-test-output",
]);

const INVESTIGATION_SCENARIOS = new Set([
  "codebase-investigation-answer",
  "rank-relevant-regions",
]);

function taskClassForScenario(
  scenarioId: string,
): HarnessParityMatrixScaffoldTaskClass {
  if (EDIT_AND_VERIFY_SCENARIOS.has(scenarioId)) return "edit-and-verify";
  if (INVESTIGATION_SCENARIOS.has(scenarioId)) return "investigation-answer";
  if (scenarioId === "frontend-preview") return "frontend-preview";
  if (scenarioId === "package-upgrade-chain") return "maintenance-chain";
  return "general-coding";
}

function supportStatusFor(
  status: HarnessParityMatrixRow["status"],
): HarnessParityMatrixScaffoldEvidence["supportStatus"] {
  if (status === "passed") return "supported";
  if (status === "skipped") return "experimental";
  return "rejected";
}

function reasonFor(
  status: HarnessParityMatrixRow["status"],
  taskClass: HarnessParityMatrixScaffoldTaskClass,
): string {
  if (status === "passed") {
    return `scenario verifier passed for scaffold task class "${taskClass}"`;
  }
  if (status === "skipped") {
    return `scenario was not executed, so scaffold task class "${taskClass}" remains experimental`;
  }
  return `scenario verifier did not pass for scaffold task class "${taskClass}"`;
}

export function scaffoldEvidenceForRow(args: {
  harnessName: string;
  scenarioId: string;
  status: HarnessParityMatrixRow["status"];
}): HarnessParityMatrixScaffoldEvidence | undefined {
  if (args.harnessName !== SCAFFOLD_HARNESS_MODE) return undefined;
  const taskClass = taskClassForScenario(args.scenarioId);
  return {
    harnessMode: SCAFFOLD_HARNESS_MODE,
    taskClass,
    supportStatus: supportStatusFor(args.status),
    reason: reasonFor(args.status, taskClass),
  };
}
