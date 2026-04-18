import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Counter, Histogram, Meter } from "@opentelemetry/api";

type WorkflowCompletedPayload = {
  workflow: string;
  runId: string;
  status: "success" | "failed" | "interrupted" | "completed-with-warnings";
  triggerEvent: string;
  durationMs: number;
  definitionPath: string;
  runDir: string;
  tags: readonly string[];
  failureKind?: "rate_limit" | "auth" | "provider";
};

type StepCompletedPayload = {
  workflow: string;
  runId: string;
  stepId: string;
  stepType: string;
  status: string;
  durationMs: number;
  costUsd?: number;
  runDir: string;
};

type AgentStepOutput = {
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  repairIterations?: Array<{
    attempt: number;
    failures: Array<{ id: string; severity?: string }>;
  }>;
};

type MetricsLogger = (msg: string, err: unknown) => void;

/**
 * Emits workflow runtime metrics (run counts, duration, step cost,
 * repair-loop hits, failure classification) off the same workflow bus
 * events the tracer subscribes to. Agent-step enrichment reads the
 * per-step result file from the run directory, matching the tracer's
 * existing pattern instead of demanding a second event protocol.
 */
export class WorkflowMetricsEmitter {
  private readonly projectDir: string;
  private readonly onEnrichmentError: MetricsLogger;
  private readonly runCounter: Counter;
  private readonly runDuration: Histogram;
  private readonly stepDuration: Histogram;
  private readonly stepCost: Histogram;
  private readonly agentTokens: Counter;
  private readonly repairLoopHits: Counter;
  private readonly failureClass: Counter;

  constructor(
    meter: Meter,
    projectDir: string,
    onEnrichmentError: MetricsLogger = () => {},
  ) {
    this.projectDir = projectDir;
    this.onEnrichmentError = onEnrichmentError;

    this.runCounter = meter.createCounter("kota.workflow.runs", {
      description: "Number of workflow runs completed, labelled by status",
    });
    this.runDuration = meter.createHistogram("kota.workflow.run.duration", {
      description: "Workflow run wall-clock duration",
      unit: "ms",
    });
    this.stepDuration = meter.createHistogram("kota.workflow.step.duration", {
      description: "Workflow step wall-clock duration",
      unit: "ms",
    });
    this.stepCost = meter.createHistogram("kota.workflow.step.cost", {
      description: "Workflow step cost in USD",
      unit: "USD",
    });
    this.agentTokens = meter.createCounter("kota.workflow.agent.tokens", {
      description: "Token consumption for agent steps, labelled by direction",
    });
    this.repairLoopHits = meter.createCounter("kota.workflow.repair_loop.hits", {
      description: "Repair-loop failed-check observations, labelled by check id",
    });
    this.failureClass = meter.createCounter("kota.workflow.failure_class", {
      description: "Classified failure counts for workflow runs (rate_limit, auth, provider)",
    });
  }

  onWorkflowCompleted(payload: WorkflowCompletedPayload): void {
    const baseAttrs = {
      "workflow.name": payload.workflow,
      "workflow.status": payload.status,
    };
    this.runCounter.add(1, baseAttrs);
    this.runDuration.record(payload.durationMs, baseAttrs);
    if (payload.failureKind) {
      this.failureClass.add(1, {
        "workflow.name": payload.workflow,
        "workflow.failure_kind": payload.failureKind,
      });
    }
  }

  onStepCompleted(payload: StepCompletedPayload): void {
    const attrs = {
      "workflow.name": payload.workflow,
      "workflow.step.id": payload.stepId,
      "workflow.step.type": payload.stepType,
      "workflow.step.status": payload.status,
    };
    this.stepDuration.record(payload.durationMs, attrs);
    if (payload.costUsd != null) {
      this.stepCost.record(payload.costUsd, attrs);
    }
    if (payload.stepType !== "agent") return;

    const output = this.readAgentStepOutput(payload.runDir, payload.stepId);
    if (!output) return;

    if (output.totalCostUsd != null) {
      this.stepCost.record(output.totalCostUsd, attrs);
    }
    if (output.inputTokens != null) {
      this.agentTokens.add(output.inputTokens, {
        "workflow.name": payload.workflow,
        "workflow.step.id": payload.stepId,
        "token.direction": "input",
      });
    }
    if (output.outputTokens != null) {
      this.agentTokens.add(output.outputTokens, {
        "workflow.name": payload.workflow,
        "workflow.step.id": payload.stepId,
        "token.direction": "output",
      });
    }
    if (output.repairIterations) {
      for (const iter of output.repairIterations) {
        for (const failure of iter.failures) {
          this.repairLoopHits.add(1, {
            "workflow.name": payload.workflow,
            "workflow.step.id": payload.stepId,
            "repair.check_id": failure.id,
          });
        }
      }
    }
  }

  private readAgentStepOutput(runDir: string, stepId: string): AgentStepOutput | undefined {
    const filePath = join(resolve(this.projectDir, runDir), "steps", `${stepId}.json`);
    if (!existsSync(filePath)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const output = raw?.output;
      if (output && typeof output === "object" && !Array.isArray(output)) {
        return output as AgentStepOutput;
      }
      return undefined;
    } catch (err) {
      this.onEnrichmentError(
        `Metrics could not read step output ${filePath}`,
        err,
      );
      return undefined;
    }
  }
}
