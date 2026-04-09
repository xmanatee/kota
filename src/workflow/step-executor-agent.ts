import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  executeWithAgentSDK,
} from "../agent-sdk/index.js";
import type { SDKMessage } from "../agent-sdk/types.js";
import type { KotaConfig } from "../config.js";
import { tryEmit } from "../event-bus.js";
import { ToolTelemetry } from "../tool-telemetry.js";
import type { ToolResult } from "../tools/index.js";
import { validatePayloadSchema } from "./payload-validator.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_MODEL,
  withRetry,
} from "./step-executor-retry.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";

export type WorkflowStepOutput =
  | ToolResult
  | { content: string; streamedText?: string; sessionId?: string; turns?: number; totalCostUsd?: number; subtype?: string }
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | undefined;

export type AgentStepConfig = {
  model?: string;
  config?: KotaConfig;
  projectDir: string;
  log?: (message: string) => void;
};

export {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_MODEL,
  withRetry,
};

export function resolveAgentModel(
  step: WorkflowAgentStep,
  agentConfig: AgentStepConfig,
): string {
  return (
    (step.agentName ? agentConfig.config?.agentModels?.[step.agentName] : undefined) ??
    step.model ??
    agentConfig.model ??
    agentConfig.config?.model ??
    DEFAULT_MODEL
  );
}

function shouldExposeOutput(output: unknown): boolean {
  if (output === undefined) return false;
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "skipped" in output
  ) {
    return false;
  }
  return true;
}

function getExposedStepOutputs(
  definition: WorkflowDefinition,
  priorStepOutputs: Record<string, unknown>,
): Array<[string, unknown]> {
  return definition.steps
    .filter((candidate) => "exposeOutputToAgent" in candidate && candidate.exposeOutputToAgent)
    .map((candidate) => [candidate.id, priorStepOutputs[candidate.id]] as [string, unknown])
    .filter(([, output]) => shouldExposeOutput(output));
}

export function buildAgentPrompt(
  definition: WorkflowDefinition,
  step: WorkflowAgentStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  projectDir: string,
  priorStepOutputs: Record<string, unknown>,
): { systemPromptAppend: string; prompt: string } {
  const promptBody = readFileSync(
    resolve(projectDir, step.promptPath),
    "utf-8",
  );
  const triggerPayloadKeys = Object.keys(trigger.payload);
  const exposedOutputs = getExposedStepOutputs(definition, priorStepOutputs);
  const lines = [
    "Execute one KOTA workflow step in this repository.",
    `Workflow: ${definition.name}`,
    `Step: ${step.id}`,
    `Run ID: ${metadata.id}`,
    `Run directory: ${metadata.runDir}`,
    `Workflow definition: ${metadata.definitionPath}`,
    `Prompt file: ${step.promptPath}`,
    `Project root: ${projectDir}`,
    `Trigger event: ${trigger.event}`,
    "Only runtime-only workflow facts are injected here. Discover repository context yourself.",
  ];
  if (triggerPayloadKeys.length > 0) {
    lines.push(
      "",
      "Trigger payload:",
      "```json",
      JSON.stringify(trigger.payload, null, 2),
      "```",
    );
  }
  if (exposedOutputs.length > 0) {
    lines.push("", "Exposed step outputs:");
    for (const [id, output] of exposedOutputs) {
      lines.push(`<step id="${id}">`, JSON.stringify(output, null, 2), "</step>");
    }
  }

  lines.push(
    "",
    "There is intentionally no fixed checklist here. Decide what to inspect, what to ignore, and how deep to go.",
    "Use the workflow instructions in your system prompt.",
    "Work directly instead of narrating intent.",
    'Do not emit progress filler such as "Let me..." or "I will...".',
    "If you leave a textual summary, keep it brief and factual.",
    "Write any run-specific artifacts under the run directory when useful.",
    "Finish this step fully, then stop.",
  );
  if (step.outputFormat === "json") {
    lines.push("", "End your final response with a fenced JSON block containing your structured output.");
  }
  return {
    systemPromptAppend: promptBody,
    prompt: lines.join("\n"),
  };
}

function makeToolTelemetryTracker(
  telemetry: ToolTelemetry,
  onMessage: (message: SDKMessage) => void,
): (message: SDKMessage) => void {
  const pending = new Map<string, { name: string; startMs: number }>();
  return (message: SDKMessage) => {
    onMessage(message);
    if (message.type === "assistant") {
      const raw = message as unknown as { message?: { content?: unknown[] }; content?: unknown[] };
      const content = raw.message?.content ?? raw.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; id?: string; name?: string };
        if (b.type === "tool_use" && b.id && b.name) {
          pending.set(b.id, { name: b.name, startMs: Date.now() });
        }
      }
    }
    if (message.type === "user") {
      const raw = message as unknown as { message?: { content?: unknown[] } };
      const content = raw.message?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === "tool_result" && b.tool_use_id) {
          const entry = pending.get(b.tool_use_id);
          if (entry) {
            const durationMs = Date.now() - entry.startMs;
            const isError = b.is_error === true;
            const errorMsg = isError
              ? (typeof b.content === "string" ? b.content : JSON.stringify(b.content)).slice(0, 200)
              : undefined;
            telemetry.record(entry.name, durationMs, !isError, errorMsg);
            pending.delete(b.tool_use_id);
          }
        }
      }
    }
  };
}

function writeToolTelemetryArtifact(
  stepId: string,
  metadata: WorkflowRunMetadata,
  projectDir: string,
  telemetry: ToolTelemetry,
): void {
  if (telemetry.getTotalCalls() === 0) return;
  const tools: Record<string, Record<string, unknown>> = {};
  for (const [name, s] of telemetry.getStats()) {
    const avgMs = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
    const entry: Record<string, unknown> = {
      calls: s.calls,
      successes: s.successes,
      failures: s.failures,
      totalMs: s.totalMs,
      avgMs,
    };
    if (s.lastError !== undefined) entry.lastError = s.lastError;
    tools[name] = entry;
  }
  const payload = { summary: telemetry.getSummary(), tools };
  const filePath = join(resolve(projectDir, metadata.runDir), "steps", `${stepId}.tool-telemetry.json`);
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export async function executeAgentStep(
  definition: WorkflowDefinition,
  step: WorkflowAgentStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  abortController: AbortController,
  appendMessage: (message: SDKMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
  priorStepOutputs: Record<string, unknown> = {},
): Promise<WorkflowStepOutput> {
  const agentPrompt = buildAgentPrompt(
    definition,
    step,
    metadata,
    trigger,
    agentConfig.projectDir,
    priorStepOutputs,
  );
  const promptDir = dirname(resolve(agentConfig.projectDir, step.promptPath));
  const systemPrompt = buildClaudeCodeSystemPrompt(
    agentConfig.config,
    agentPrompt.systemPromptAppend,
    promptDir,
    agentConfig.projectDir,
  );
  const systemPromptAppend =
    typeof systemPrompt === "string" ? systemPrompt : systemPrompt.append;
  writeInputs(systemPromptAppend, agentPrompt.prompt);

  const stepTelemetry = new ToolTelemetry();
  const trackedMessage = makeToolTelemetryTracker(stepTelemetry, appendMessage);

  let lastSchemaError: string | undefined;

  const runAttempt = async (): Promise<WorkflowStepOutput> => {
    const prompt = lastSchemaError
      ? `${agentPrompt.prompt}\n\n[Previous output failed schema validation: ${lastSchemaError}\nPlease include all required fields in your JSON block and try again.]`
      : agentPrompt.prompt;
    try {
      const result = await executeWithAgentSDK(prompt, {
        model: resolveAgentModel(step, agentConfig),
        cwd: agentConfig.projectDir,
        systemPrompt,
        maxTurns: step.maxTurns,
        maxBudgetUsd: step.maxBudgetUsd,
        thinkingEnabled: step.thinkingEnabled,
        thinkingBudget: step.thinkingBudget,
        allowedTools: step.allowedTools,
        disallowedTools: step.disallowedTools,
        permissionMode: step.permissionMode,
        persistSession: false,
        settingSources: step.settingSources,
        abortController,
        onMessage: trackedMessage,
      }, {
        write: () => true,
      });
      if (result.subtype === "error_max_budget_usd") {
        tryEmit("workflow.cost.ceiling.exceeded", {
          workflow: definition.name,
          runId: metadata.id,
          stepId: step.id,
          budgetUsd: step.maxBudgetUsd!,
          actualCostUsd: result.totalCostUsd,
        });
      }
      if (
        step.maxCostUsd != null &&
        result.totalCostUsd != null &&
        result.totalCostUsd > step.maxCostUsd
      ) {
        throw new Error(
          `Agent step "${step.id}" cost_cap_exceeded: spent $${result.totalCostUsd.toFixed(4)}, cap $${step.maxCostUsd.toFixed(4)}`,
        );
      }
      if (result.isError) {
        const reason = result.subtype ?? "error";
        const detail = result.text.trim() || "Agent step returned an error result";
        const classified = classifyAgentRuntimeFailure(detail);
        if (classified) {
          throw new AgentStepRuntimeError(
            `Agent step "${step.id}" failed (${reason}): ${detail}`,
            classified.kind,
            classified.retryable,
          );
        }
        throw new Error(`Agent step "${step.id}" failed (${reason}): ${detail}`);
      }
      if (step.outputFormat === "json") {
        try {
          return extractJsonOutput(step.id, result.text, step.outputSchema) as WorkflowStepOutput;
        } catch (err) {
          if (err instanceof JsonSchemaValidationError) {
            lastSchemaError = err.validationDetail;
          }
          throw err;
        }
      }
      return {
        content: result.text,
        streamedText: result.streamedText,
        sessionId: result.sessionId,
        turns: result.turns,
        totalCostUsd: result.totalCostUsd,
        subtype: result.subtype,
      };
    } catch (error) {
      if (
        error instanceof AgentStepRuntimeError ||
        error instanceof JsonSchemaValidationError ||
        (error instanceof Error && error.name === "AbortError") ||
        abortController.signal.aborted
      ) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const classified = classifyAgentRuntimeFailure(detail);
      if (classified) {
        throw new AgentStepRuntimeError(
          `Agent step "${step.id}" failed: ${detail}`,
          classified.kind,
          classified.retryable,
        );
      }
      throw error;
    }
  };

  const output = step.retry
    ? await withRetry(runAttempt, step.retry, agentConfig.log)
    : await runAttempt();

  writeToolTelemetryArtifact(step.id, metadata, agentConfig.projectDir, stepTelemetry);

  return output;
}

export class JsonSchemaValidationError extends Error {
  constructor(
    message: string,
    readonly validationDetail: string,
  ) {
    super(message);
    this.name = "JsonSchemaValidationError";
  }
}

function extractJsonOutput(
  stepId: string,
  text: string,
  outputSchema: Record<string, unknown> | undefined,
): unknown {
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) {
    throw new Error(
      `Agent step "${stepId}" outputFormat is "json" but no fenced JSON block was found in the response`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error(
      `Agent step "${stepId}" outputFormat is "json" but the fenced block contains invalid JSON`,
    );
  }
  if (outputSchema !== undefined) {
    const validationError = validatePayloadSchema(outputSchema, parsed as Record<string, unknown>);
    if (validationError) {
      throw new JsonSchemaValidationError(
        `Agent step "${stepId}" output failed schema validation: ${validationError}`,
        validationError,
      );
    }
  }
  return parsed;
}
