import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  executeWithAgentSDK,
} from "../agent-sdk/index.js";
import type { SDKMessage } from "../agent-sdk/types.js";
import type { KotaConfig } from "../config.js";
import type { ToolResult } from "../tools/index.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import type {
  WorkflowAgentBackoffKind,
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowRetryConfig,
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

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AgentStepRuntimeError extends Error {
  constructor(
    message: string,
    readonly kind: WorkflowAgentBackoffKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AgentStepRuntimeError";
  }
}

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
      if (
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof AgentStepRuntimeError && !error.retryable)
      ) {
        throw error;
      }
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

function classifyAgentRuntimeFailure(
  text: string,
): { kind: WorkflowAgentBackoffKind; retryable: boolean } | null {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("you've hit your limit") ||
    normalized.includes("hit your limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota")
  ) {
    return { kind: "rate_limit", retryable: false };
  }

  if (
    normalized.includes("not logged in") ||
    normalized.includes("please run /login") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication")
  ) {
    return { kind: "auth", retryable: false };
  }

  if (
    normalized.includes("network error") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("spawn ") ||
    normalized.includes("broken pipe") ||
    normalized.includes("connection reset")
  ) {
    return { kind: "provider", retryable: true };
  }

  return null;
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
    try {
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
      return result;
    } catch (error) {
      if (
        error instanceof AgentStepRuntimeError ||
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
