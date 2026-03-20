import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  executeWithAgentSDK,
} from "../agent-sdk/index.js";
import type { SDKMessage } from "../agent-sdk/types.js";
import type { KotaConfig } from "../config.js";
import type { ToolResult } from "../tools/index.js";
import type {
  WorkflowAgentStep,
  WorkflowCodeStep,
  WorkflowDefinition,
  WorkflowEmitStep,
  WorkflowRestartStep,
  WorkflowRetryConfig,
  WorkflowRunMetadata,
  WorkflowRunTrigger,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowToolStep,
} from "./types.js";

export type WorkflowStepOutput =
  | ToolResult
  | {
      content: string;
      streamedText?: string;
      sessionId?: string;
      turns?: number;
      totalCostUsd?: number;
      subtype?: string;
    }
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

const DEFAULT_MODEL = "claude-sonnet-4-6";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retry: WorkflowRetryConfig,
  log?: (message: string) => void,
): Promise<T> {
  let lastError: unknown;
  let delayMs = retry.initialDelayMs;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retry.maxAttempts) {
        log?.(
          `Attempt ${attempt}/${retry.maxAttempts} failed; retrying in ${delayMs}ms. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delayMs);
        delayMs = Math.round(delayMs * retry.backoffFactor);
      }
    }
  }
  throw lastError;
}

export async function resolveValue<T>(
  value: T | ((context: WorkflowStepContext) => T | Promise<T>),
  context: WorkflowStepContext,
): Promise<T> {
  if (typeof value === "function") {
    return (value as (ctx: WorkflowStepContext) => T | Promise<T>)(context);
  }
  return value;
}

export async function shouldRunStep(
  step: WorkflowStep,
  context: WorkflowStepContext,
): Promise<boolean> {
  if (!step.when) return true;
  return Boolean(await step.when(context));
}

export async function executeToolStep(
  step: WorkflowToolStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const input = await resolveValue(step.input ?? {}, context);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Tool step "${step.id}" resolved to a non-object input`);
  }
  return context.runTool(step.tool, input);
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
    "",
    "Trigger payload:",
    "```json",
    JSON.stringify(trigger.payload, null, 2),
    "```",
  ];

  const meaningfulOutputs = Object.entries(priorStepOutputs).filter(
    ([, v]) =>
      v !== null &&
      typeof v === "object" &&
      !("skipped" in (v as object)),
  );
  if (meaningfulOutputs.length > 0) {
    lines.push("", "Prior step outputs:");
    for (const [id, output] of meaningfulOutputs) {
      lines.push(`<step id="${id}">`, JSON.stringify(output, null, 2), "</step>");
    }
  }

  lines.push(
    "",
    "Use the workflow instructions in your system prompt.",
    "Work directly instead of narrating intent.",
    'Do not emit progress filler such as "Let me..." or "I will...".',
    "If you leave a textual summary, keep it brief and factual.",
    "Write any run-specific artifacts under the run directory when useful.",
    "Finish this step fully, then stop.",
  );
  return {
    systemPromptAppend: promptBody,
    prompt: lines.join("\n"),
  };
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (step.timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      abortController.abort(
        new Error(`Agent step "${step.id}" timed out after ${step.timeoutMs}ms`),
      );
    }, step.timeoutMs);
  }

  const runAttempt = async () => {
    const result = await executeWithAgentSDK(agentPrompt.prompt, {
      model: step.model ?? agentConfig.model ?? agentConfig.config?.model ?? DEFAULT_MODEL,
      cwd: agentConfig.projectDir,
      systemPrompt,
      maxTurns: step.maxTurns,
      maxBudgetUsd: step.maxBudgetUsd,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      permissionMode: step.permissionMode,
      persistSession: false,
      settingSources: step.settingSources,
      abortController,
      onMessage: appendMessage,
    }, {
      write: () => true,
    });
    if (result.isError) {
      const reason = result.subtype ?? "error";
      const detail = result.text.trim() || "Agent step returned an error result";
      throw new Error(`Agent step "${step.id}" failed (${reason}): ${detail}`);
    }
    return result;
  };

  let result: Awaited<ReturnType<typeof executeWithAgentSDK>>;
  try {
    result = step.retry
      ? await withRetry(runAttempt, step.retry, agentConfig.log)
      : await runAttempt();
  } finally {
    clearTimeout(timeoutHandle);
  }

  return {
    content: result.text,
    streamedText: result.streamedText,
    sessionId: result.sessionId,
    turns: result.turns,
    totalCostUsd: result.totalCostUsd,
    subtype: result.subtype,
  };
}

export async function executeEmitStep(
  step: WorkflowEmitStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const payload = await resolveValue(step.payload ?? {}, context);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Emit step "${step.id}" resolved to a non-object payload`);
  }
  context.emit(step.event, payload as Record<string, unknown>);
  return { event: step.event, payload };
}

export async function executeRestartStep(
  step: WorkflowRestartStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const missingRequirements = step.requires.filter((stepId) => {
    const result = context.stepResults[stepId];
    return !result || result.status !== "success";
  });
  if (missingRequirements.length > 0) {
    throw new Error(
      `Restart step "${step.id}" requires successful verification steps: ${missingRequirements.join(", ")}`,
    );
  }

  const reason = await resolveValue(
    step.reason ?? `${context.workflow.name} requested restart`,
    context,
  );
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`Restart step "${step.id}" resolved to an empty reason`);
  }
  context.requestRestart(reason);
  return {
    event: "runtime.restart_requested",
    payload: {
      reason,
      workflow: context.workflow.name,
      runId: context.workflow.runId,
      requires: step.requires,
    },
  };
}

export async function executeCodeStep(
  step: WorkflowCodeStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  return (await step.run(context)) as WorkflowStepOutput;
}

export async function executeStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  abortController: AbortController,
  appendMessage: (message: SDKMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
): Promise<WorkflowStepOutput> {
  if (step.type === "tool") return executeToolStep(step, context);
  if (step.type === "agent") {
    return executeAgentStep(
      definition,
      step,
      metadata,
      trigger,
      abortController,
      appendMessage,
      writeInputs,
      agentConfig,
      context.stepOutputs,
    );
  }
  if (step.type === "emit") return executeEmitStep(step, context);
  if (step.type === "restart") return executeRestartStep(step, context);
  return executeCodeStep(step, context);
}
