import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Attributes, Counter, Histogram, Meter } from "@opentelemetry/api";
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";

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
  autonomyMode?: AutonomyMode;
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
  autonomyMode?: AutonomyMode;
};

type SessionAutonomyChangedPayload = {
  sessionId: string;
  from: AutonomyMode;
  to: AutonomyMode;
};

type AgentStepOutput = {
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
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
  private readonly sessionAutonomyTransitions: Counter;
  private readonly configReloadAttempts: Counter;

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
    this.sessionAutonomyTransitions = meter.createCounter(
      "kota.workflow.session_autonomy_transitions",
      {
        description:
          "Session autonomy-mode transitions, labelled by autonomy.from and autonomy.to",
      },
    );
    this.configReloadAttempts = meter.createCounter(
      "kota.daemon.config_reload.attempts",
      {
        description: "Daemon config reload attempts, labelled by outcome and reload shape",
      },
    );
  }

  onWorkflowCompleted(payload: WorkflowCompletedPayload): void {
    const baseAttrs: Record<string, string> = {
      "workflow.name": payload.workflow,
      "workflow.status": payload.status,
    };
    if (payload.autonomyMode !== undefined) baseAttrs.autonomy_mode = payload.autonomyMode;
    this.runCounter.add(1, baseAttrs);
    this.runDuration.record(payload.durationMs, baseAttrs);
    if (payload.failureKind) {
      const failureAttrs: Record<string, string> = {
        "workflow.name": payload.workflow,
        "workflow.failure_kind": payload.failureKind,
      };
      if (payload.autonomyMode !== undefined) failureAttrs.autonomy_mode = payload.autonomyMode;
      this.failureClass.add(1, failureAttrs);
    }
  }

  onStepCompleted(payload: StepCompletedPayload): void {
    const attrs: Record<string, string> = {
      "workflow.name": payload.workflow,
      "workflow.step.id": payload.stepId,
      "workflow.step.type": payload.stepType,
      "workflow.step.status": payload.status,
    };
    if (payload.autonomyMode !== undefined) attrs.autonomy_mode = payload.autonomyMode;
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
      const tokenAttrs: Record<string, string> = {
        "workflow.name": payload.workflow,
        "workflow.step.id": payload.stepId,
        "token.direction": "input",
      };
      if (payload.autonomyMode !== undefined) tokenAttrs.autonomy_mode = payload.autonomyMode;
      this.agentTokens.add(output.inputTokens, tokenAttrs);
    }
    if (output.outputTokens != null) {
      const tokenAttrs: Record<string, string> = {
        "workflow.name": payload.workflow,
        "workflow.step.id": payload.stepId,
        "token.direction": "output",
      };
      if (payload.autonomyMode !== undefined) tokenAttrs.autonomy_mode = payload.autonomyMode;
      this.agentTokens.add(output.outputTokens, tokenAttrs);
    }
    const repairIterations = readRepairIterations(output);
    if (repairIterations.length > 0) {
      for (const iter of repairIterations) {
        for (const failure of iter.failures) {
          const repairAttrs: Record<string, string> = {
            "workflow.name": payload.workflow,
            "workflow.step.id": payload.stepId,
            "repair.check_id": failure.id,
          };
          if (payload.autonomyMode !== undefined) repairAttrs.autonomy_mode = payload.autonomyMode;
          this.repairLoopHits.add(1, repairAttrs);
        }
      }
    }
  }

  onSessionAutonomyChanged(payload: SessionAutonomyChangedPayload): void {
    this.sessionAutonomyTransitions.add(1, {
      "autonomy.from": payload.from,
      "autonomy.to": payload.to,
    });
  }

  onDaemonConfigReload(payload: BusEvents["daemon.config.reload"]): void {
    const attrs: Attributes = {
      "daemon.config_reload.scope": payload.scope,
      "daemon.config_reload.outcome": payload.outcome,
      "daemon.config_reload.reload_kind": payload.reloadKind,
      "daemon.config_reload.full_reload": payload.fullReload,
      "daemon.config_reload.changed_module_count": payload.changedModules.length,
      "daemon.config_reload.workflow_count": payload.workflowCount,
    };
    if (payload.outcome === "failure") {
      attrs["daemon.config_reload.error_class"] = payload.errorClass;
    }
    this.configReloadAttempts.add(1, attrs);
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
