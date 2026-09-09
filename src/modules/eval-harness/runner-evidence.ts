import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { z } from "zod";
import { type AgentUsage, AgentUsageAccumulator, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import type { ExecutableVerifier } from "./executable-verifier-types.js";
import { collectWorkspaceDiff } from "./runner-evidence-git.js";
import type { FixtureRunReport } from "./runner-types.js";

export type FixtureExecutionEvidence = {
  artifactDir: string;
  usage: AgentUsage;
  turns: number;
  toolCalls: number;
  toolResults: number;
  approvalRequests: number;
  trajectoryDiagnostics: { warningCount: number; missingStreamingFramesCount: number; unsupportedTrajectoryCount: number } | null;
  changedFiles: string[];
  /** Missing or malformed runtime evidence remains explicit and cannot support a gate. */
  issues: string[];
  traceAvailable: boolean;
};

// Decode only the persisted event fields this projection consumes. The raw
// stream is retained alongside the measurements for independent inspection.
const eventProjection = z.object({
  type: z.enum(["text", "thinking", "tool_call", "tool_result", "status", "result", "raw"]),
  toolName: z.string().optional(),
  text: z.string().optional(),
  numTurns: z.number().int().nonnegative().optional(),
});

function retainWorkflowEvidence(source: string, target: string, workingDir: string): void {
  const inside = relative(realpathSync(workingDir), realpathSync(source));
  if (!inside || inside.startsWith(`..${sep}`) || inside === "..") throw new Error("Workflow evidence escaped fixture workspace");
  mkdirSync(join(target, "steps"), { recursive: true });
  const files = ["metadata.json", ...(existsSync(join(source, "steps"))
    ? readdirSync(join(source, "steps")).filter((name) => /\.(json|jsonl|md|txt)$/.test(name)).map((name) => join("steps", name)) : [])];
  for (const file of files) {
    const path = join(source, file);
    const resolved = relative(realpathSync(source), realpathSync(path));
    if (resolved.startsWith(`..${sep}`) || resolved === ".." || !lstatSync(path).isFile()) throw new Error("Invalid workflow evidence file");
    writeFileSync(join(target, file), readFileSync(path));
  }
}

/** Collect before the fixture clone is removed; scoring remains predicate-owned. */
export async function collectFixtureExecutionEvidence(
  report: FixtureRunReport,
  verifier: ExecutableVerifier | undefined,
): Promise<FixtureExecutionEvidence> {
  const artifactDir = join(report.run.runArtifactPath, "execution-evidence");
  mkdirSync(artifactDir, { recursive: true });
  const evidence: FixtureExecutionEvidence = {
    artifactDir, usage: UNKNOWN_AGENT_USAGE, turns: 0, toolCalls: 0, toolResults: 0, approvalRequests: 0,
    trajectoryDiagnostics: null, changedFiles: [], issues: [], traceAvailable: false,
  };
  const usage = new AgentUsageAccumulator();
  const traces: string[] = [];
  const sources = report.run.rounds?.map((round) => round.runArtifactPath) ?? [report.executionOutcome.runArtifactPath];
  for (const [index, source] of sources.entries()) {
    if (source === null || !existsSync(source)) {
      evidence.issues.push(`Workflow ${index + 1}: execution artifact missing`);
      usage.observe(UNKNOWN_AGENT_USAGE);
      continue;
    }
    try {
      const target = join(artifactDir, `workflow-${index + 1}`, basename(source));
      retainWorkflowEvidence(source, target, report.workingDir);
      const metadata = readWorkflowRunMetadataFile(join(target, "metadata.json"));
      if (metadata === null) throw new Error("Workflow metadata missing");
      const steps = metadata.steps.filter((step) => step.type === "agent" && step.status !== "skipped");
      for (const step of steps) {
        if (step.type !== "agent") continue;
        usage.observe(step.usage);
        const diagnostics = step.trajectoryDiagnostics;
        if (diagnostics) {
          const total = evidence.trajectoryDiagnostics ??= { warningCount: 0, missingStreamingFramesCount: 0, unsupportedTrajectoryCount: 0 };
          total.warningCount += diagnostics.warningCount;
          total.missingStreamingFramesCount += diagnostics.missingStreamingFramesCount;
          total.unsupportedTrajectoryCount += diagnostics.unsupportedTrajectoryCount;
        }
      }
      evidence.approvalRequests += metadata.steps.filter((step) => step.type === "approval" && step.status !== "skipped").length;
      const eventFiles = readdirSync(join(target, "steps")).filter((name) => name.endsWith(".events.jsonl"));
      for (const name of eventFiles) {
        const raw = readFileSync(join(target, "steps", name), "utf8");
        const events = raw.split("\n").filter((line) => line.trim()).map((line) => eventProjection.parse(JSON.parse(line)));
        evidence.traceAvailable ||= events.length > 0;
        for (const event of events) {
          if (event.type === "tool_call") {
            evidence.toolCalls += 1;
            if (/approval|approve|ask[_-]?owner|owner[_-]?decision/i.test(event.toolName ?? "")) evidence.approvalRequests += 1;
          }
          if (event.type === "tool_result") evidence.toolResults += 1;
          if (event.type === "result") evidence.turns += event.numTurns ?? 0;
          if ((event.type === "text" || event.type === "result") && event.text) traces.push(event.text);
          if (event.type === "tool_call" || event.type === "tool_result") traces.push(`${event.type}: ${event.toolName ?? "result"}`);
        }
      }
      if (steps.length > 0 && eventFiles.length === 0) evidence.issues.push(`Workflow ${index + 1}: agent event stream missing`);
    } catch (error) {
      evidence.issues.push(`Workflow ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      usage.observe(UNKNOWN_AGENT_USAGE);
    }
  }
  evidence.usage = usage.snapshot();
  try {
    const { changedFiles, diff } = await collectWorkspaceDiff(report.workingDir, verifier);
    writeFileSync(join(artifactDir, "diff.patch"), diff);
    evidence.changedFiles = changedFiles;
  } catch (error) {
    evidence.issues.push(`Diff unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (evidence.traceAvailable) writeFileSync(join(artifactDir, "trace-summary.md"), traces.join("\n\n"));
  writeFileSync(join(artifactDir, "verification.json"), JSON.stringify({ outcome: report.run.outcome, predicates: report.predicateResults, rounds: report.run.rounds, objectiveMetricErrors: report.objectiveMetricErrors }, null, 2));
  writeFileSync(join(artifactDir, "measurements.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
