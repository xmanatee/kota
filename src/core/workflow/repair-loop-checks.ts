import { getToolEffect } from "#core/tools/index.js";
import { AgentBackoffAdmissionError } from "./agent-backoff.js";
import type {
  WorkflowRepairCheck,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";

export type RepairCheckResult = {
  id: string;
  passed: boolean;
  output: string;
  severity: "error" | "warning";
};

async function runRepairCheck(
  check: WorkflowRepairCheck,
  context: WorkflowStepContext,
  parentStep: WorkflowAgentStep,
): Promise<RepairCheckResult> {
  const severity = check.severity ?? "error";
  try {
    if (check.type === "code") {
      const output = await check.run(context, parentStep);
      return {
        id: check.id,
        passed: true,
        output:
          typeof output === "string" ? output : JSON.stringify(output ?? {}, null, 2),
        severity,
      };
    }

    const input = typeof check.input === "function"
      ? await check.input(context)
      : (check.input ?? {});
    const effect = getToolEffect(check.tool, input);
    if (effect === undefined) throw new Error(`Unknown tool: ${check.tool}`);
    if (effect.kind !== "read") {
      throw new Error(
        `Repair check "${check.id}" must resolve to a read-only tool effect`,
      );
    }
    const result = await context.runTool(check.tool, input, {
      stepId: `${parentStep.id}:repair-check:${check.id}`,
    });
    const output = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    return { id: check.id, passed: true, output, severity };
  } catch (error) {
    if (
      error instanceof AgentBackoffAdmissionError ||
      error instanceof AgentStepRuntimeError
    ) {
      throw error;
    }
    const output = error instanceof Error ? error.message : String(error);
    // Tool checks can be unavailable in daemon workflow contexts; demote those
    // failures so the repair agent does not chase missing module wiring.
    const effectiveSeverity =
      check.type !== "code" && output.startsWith("Unknown tool:") ? "warning" : severity;
    return { id: check.id, passed: false, output, severity: effectiveSeverity };
  }
}

/**
 * Group checks by phase and run phases sequentially. Within a phase, checks
 * run in parallel. If any phase produces error-severity failures, later
 * phases are skipped.
 */
export async function runChecksPhased(
  checks: WorkflowRepairCheck[],
  context: WorkflowStepContext,
  parentStep: WorkflowAgentStep,
): Promise<{ failures: RepairCheckResult[]; warnings: RepairCheckResult[] }> {
  const phases = new Map<number, WorkflowRepairCheck[]>();
  for (const check of checks) {
    const p = check.phase ?? 0;
    if (!phases.has(p)) phases.set(p, []);
    phases.get(p)!.push(check);
  }
  const sortedPhases = [...phases.keys()].sort((a, b) => a - b);

  const allResults: RepairCheckResult[] = [];
  for (const phase of sortedPhases) {
    const phaseChecks = phases.get(phase)!;
    const results = await Promise.all(
      phaseChecks.map((c) => runRepairCheck(c, context, parentStep)),
    );
    allResults.push(...results);
    const hasErrors = results.some((r) => !r.passed && r.severity === "error");
    if (hasErrors) break;
  }

  return {
    failures: allResults.filter((r) => !r.passed && r.severity === "error"),
    warnings: allResults.filter((r) => !r.passed && r.severity === "warning"),
  };
}
