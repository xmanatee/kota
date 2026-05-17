import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT_CONTEXT, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowStepSkipReason } from "#core/workflow/run-types.js";

const TRACER_NAME = "kota-workflow";

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
  skipReason?: WorkflowStepSkipReason;
};

type AgentStepOutput = {
  turns?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};

type TracerLogger = (msg: string, err: unknown) => void;

export class WorkflowTracer {
  private runSpans = new Map<string, Span>();
  private stepSpans = new Map<string, Span>();
  private modelLookup: Map<string, string>;
  private projectDir: string;
  private onEnrichmentError: TracerLogger;

  constructor(
    projectDir: string,
    modelLookup: Map<string, string>,
    onEnrichmentError: TracerLogger = () => {},
  ) {
    this.projectDir = projectDir;
    this.modelLookup = modelLookup;
    this.onEnrichmentError = onEnrichmentError;
  }

  onWorkflowStarted(payload: {
    workflow: string;
    runId: string;
    triggerEvent: string;
    runDir: string;
    startedAt: string;
    autonomyMode?: AutonomyMode;
  }): void {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan("workflow.run", {
      attributes: {
        "workflow.name": payload.workflow,
        "workflow.run_id": payload.runId,
        "workflow.trigger_event": payload.triggerEvent,
        "workflow.run_dir": payload.runDir,
        ...(payload.autonomyMode !== undefined ? { autonomy_mode: payload.autonomyMode } : {}),
      },
      startTime: new Date(payload.startedAt),
    });
    this.runSpans.set(payload.runId, span);
  }

  onStepStarted(payload: {
    workflow: string;
    runId: string;
    stepId: string;
    stepType: string;
    startedAt: string;
    autonomyMode?: AutonomyMode;
  }): void {
    const tracer = trace.getTracer(TRACER_NAME);
    const parentSpan = this.runSpans.get(payload.runId);
    const parentContext = parentSpan
      ? trace.setSpan(ROOT_CONTEXT, parentSpan)
      : ROOT_CONTEXT;
    const span = tracer.startSpan(
      `step.${payload.stepType}`,
      {
        attributes: {
          "workflow.name": payload.workflow,
          "workflow.run_id": payload.runId,
          "workflow.step.id": payload.stepId,
          "workflow.step.type": payload.stepType,
          ...(payload.autonomyMode !== undefined ? { autonomy_mode: payload.autonomyMode } : {}),
        },
        startTime: new Date(payload.startedAt),
      },
      parentContext,
    );
    this.stepSpans.set(`${payload.runId}:${payload.stepId}`, span);
  }

  onStepCompleted(payload: StepCompletedPayload): void {
    const key = `${payload.runId}:${payload.stepId}`;
    const span = this.stepSpans.get(key);
    if (!span) return;

    span.setAttribute("workflow.step.status", payload.status);
    span.setAttribute("workflow.step.duration_ms", payload.durationMs);

    if (payload.costUsd != null) {
      span.setAttribute("workflow.step.cost_usd", payload.costUsd);
    }

    if (payload.skipReason) {
      span.setAttribute("workflow.step.skip_reason", payload.skipReason.kind);
      if (payload.skipReason.label) {
        span.setAttribute("workflow.step.skip_label", payload.skipReason.label);
      }
    }

    // Agent steps may resolve autonomyMode later than onStepStarted (the step
    // carries its own declaration); non-agent steps inherit the workflow
    // default and are already tagged on the started span. Set on completion
    // too so the span carries the same mode the payload reports.
    if (payload.autonomyMode !== undefined) {
      span.setAttribute("autonomy_mode", payload.autonomyMode);
    }

    if (payload.stepType === "agent") {
      const modelKey = `${payload.workflow}:${payload.stepId}`;
      const model = this.modelLookup.get(modelKey);
      if (model) {
        span.setAttribute("workflow.step.model", model);
      }
      const agentOutput = this.readAgentStepOutput(payload.runDir, payload.stepId);
      if (agentOutput) {
        if (agentOutput.turns != null) {
          span.setAttribute("workflow.step.turns", agentOutput.turns);
        }
        if (agentOutput.totalCostUsd != null) {
          span.setAttribute("workflow.step.total_cost_usd", agentOutput.totalCostUsd);
        }
        if (agentOutput.inputTokens != null) {
          span.setAttribute("workflow.step.input_tokens", agentOutput.inputTokens);
        }
        if (agentOutput.outputTokens != null) {
          span.setAttribute("workflow.step.output_tokens", agentOutput.outputTokens);
        }
      }
    }

    if (payload.status === "failed") {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    this.stepSpans.delete(key);
  }

  onWorkflowCompleted(payload: {
    workflow: string;
    runId: string;
    status: string;
    durationMs: number;
    triggerEvent: string;
    tags: readonly string[];
    autonomyMode?: AutonomyMode;
  }): void {
    const span = this.runSpans.get(payload.runId);
    if (!span) return;

    span.setAttribute("workflow.status", payload.status);
    span.setAttribute("workflow.duration_ms", payload.durationMs);
    if (payload.tags.length > 0) {
      span.setAttribute("workflow.tags", payload.tags.join(","));
    }
    if (payload.autonomyMode !== undefined) {
      span.setAttribute("autonomy_mode", payload.autonomyMode);
    }

    if (payload.status === "failed" || payload.status === "interrupted") {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    this.runSpans.delete(payload.runId);
  }

  onDaemonConfigReload(payload: BusEvents["daemon.config.reload"]): void {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan("daemon.config.reload", {
      attributes: {
        "daemon.config_reload.scope": payload.scope,
        "daemon.config_reload.outcome": payload.outcome,
        "daemon.config_reload.reload_kind": payload.reloadKind,
        "daemon.config_reload.full_reload": payload.fullReload,
        "daemon.config_reload.changed_module_count": payload.changedModules.length,
        "daemon.config_reload.workflow_count": payload.workflowCount,
        ...(payload.outcome === "failure"
          ? {
              "daemon.config_reload.error_class": payload.errorClass,
              "daemon.config_reload.error_message": payload.errorMessage,
            }
          : {}),
      },
      startTime: new Date(payload.timestamp),
    });
    span.setStatus({
      code: payload.outcome === "failure" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    span.end(new Date(payload.timestamp));
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
        `Tracer could not read step output ${filePath}`,
        err,
      );
      return undefined;
    }
  }
}

export function buildModelLookup(
  workflows: ReadonlyArray<{ name: string; steps: ReadonlyArray<{ id: string; type: string; model?: string }> }>,
  agentModels?: Record<string, string>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const wf of workflows) {
    for (const step of wf.steps) {
      if (step.type !== "agent") continue;
      const agentStep = step as { id: string; agentName?: string; model?: string };
      const model =
        (agentStep.agentName && agentModels?.[agentStep.agentName]) ??
        agentStep.model;
      if (model) {
        lookup.set(`${wf.name}:${step.id}`, model);
      }
    }
  }
  return lookup;
}
