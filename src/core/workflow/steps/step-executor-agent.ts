import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  buildClaudeCodeSystemPrompt,
  createOwnerQuestionMcpServers,
  executeWithAgentSDK,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#core/agent-sdk/index.js";
import type { SDKMessage, SDKPermissionMode } from "#core/agent-sdk/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ToolResult } from "#core/tools/index.js";
import { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import { validatePayloadSchema } from "../payload-validator.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "../types.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
} from "./step-executor-retry.js";

export type WorkflowStepOutput =
  | ToolResult
  | { content: string; streamedText?: string; sessionId?: string; turns?: number; totalCostUsd?: number; inputTokens?: number; outputTokens?: number; subtype?: string }
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
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
};

export {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
};

export function resolveAgentModel(
  step: WorkflowAgentStep,
  agentConfig: AgentStepConfig,
): string {
  return (
    (step.agentName ? agentConfig.config?.agentModels?.[step.agentName] : undefined) ??
    step.model
  );
}

/**
 * Pick the startDir for system-prompt context discovery. When the module's
 * prompt directory lives inside the project, we walk from there so
 * closer-scoped `.kota.md`, `AGENTS.md`, and `CLAUDE.md` files win. When the
 * module lives outside the project (e.g. KOTA running against an external
 * project), the module's tree has nothing relevant to say about the project,
 * so discovery starts from the project root instead.
 */
export function resolvePromptContextStartDir(
  promptDir: string,
  projectDir: string,
): string {
  const rel = relative(projectDir, promptDir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return promptDir;
  }
  return projectDir;
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
    resolve(step.moduleRoot, step.promptPath),
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
    `For high-stakes decisions that are unsafe to resolve alone, use ${KOTA_OWNER_QUESTIONS_MCP_TOOL}.`,
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

function includeOwnerQuestionTool(allowedTools: string[] | undefined): string[] | undefined {
  if (!allowedTools) return undefined;
  if (allowedTools.includes(KOTA_OWNER_QUESTIONS_MCP_TOOL)) return allowedTools;
  return [...allowedTools, KOTA_OWNER_QUESTIONS_MCP_TOOL];
}

function excludeOwnerQuestionTool(disallowedTools: string[] | undefined): string[] | undefined {
  return disallowedTools?.filter((tool) => tool !== KOTA_OWNER_QUESTIONS_MCP_TOOL);
}

const SDK_PASSIVE_ALLOWED_TOOLS = [
  "Read",
  "LS",
  "Grep",
  "Glob",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
] as const;

const SDK_PASSIVE_ALLOWED_TOOL_SET = new Set<string>(SDK_PASSIVE_ALLOWED_TOOLS);

function resolvePassiveAllowedTools(
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
): string[] {
  const requested = allowedTools ?? [...SDK_PASSIVE_ALLOWED_TOOLS];
  const unsafe = requested.filter(
    (tool) =>
      tool !== KOTA_OWNER_QUESTIONS_MCP_TOOL &&
      !SDK_PASSIVE_ALLOWED_TOOL_SET.has(tool),
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Passive agent steps may only allow read-only SDK tools; disallowed here: ${unsafe.join(", ")}`,
    );
  }
  const disallowed = new Set(excludeOwnerQuestionTool(disallowedTools) ?? []);
  return includeOwnerQuestionTool(
    requested.filter((tool) => !disallowed.has(tool)),
  ) as string[];
}

function resolveSdkPermissions(
  mode: AutonomyMode,
  permissionMode: SDKPermissionMode,
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
): {
  permissionMode: SDKPermissionMode;
  allowedTools: string[] | undefined;
  disallowedTools: string[] | undefined;
} {
  if (mode === "autonomous") {
    return {
      permissionMode,
      allowedTools: includeOwnerQuestionTool(allowedTools),
      disallowedTools: excludeOwnerQuestionTool(disallowedTools),
    };
  }
  if (mode === "supervised") {
    throw new Error(
      "Workflow agent steps cannot use supervised autonomyMode because SDK tool calls cannot be routed through KOTA approvals",
    );
  }
  return {
    permissionMode: "default",
    allowedTools: resolvePassiveAllowedTools(allowedTools, disallowedTools),
    disallowedTools: undefined,
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
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.projectDir);

  let skillsPrompt: string | undefined;
  if (step.agentName && agentConfig.resolveAgentDef && agentConfig.resolveSkillsPrompt) {
    const agentDef = agentConfig.resolveAgentDef(step.agentName);
    if (agentDef?.skills) {
      skillsPrompt = agentConfig.resolveSkillsPrompt(agentDef.skills, step.agentName);
    }
  }

  const systemPrompt = buildClaudeCodeSystemPrompt(
    agentConfig.config,
    agentPrompt.systemPromptAppend,
    contextStartDir,
    agentConfig.projectDir,
    skillsPrompt,
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
    const sdkPermissions = resolveSdkPermissions(
      step.autonomyMode,
      step.permissionMode,
      step.allowedTools,
      step.disallowedTools,
    );
    try {
      const result = await executeWithAgentSDK(prompt, {
        model: resolveAgentModel(step, agentConfig),
        cwd: agentConfig.projectDir,
        systemPrompt,
        maxTurns: step.maxTurns,
        effort: step.effort,
        thinkingEnabled: step.thinkingEnabled,
        thinkingBudget: step.thinkingBudget,
        allowedTools: sdkPermissions.allowedTools,
        disallowedTools: sdkPermissions.disallowedTools,
        mcpServers: createOwnerQuestionMcpServers(
          `workflow:${metadata.workflow}/${metadata.id}/${step.id}`,
        ),
        permissionMode: sdkPermissions.permissionMode,
        persistSession: false,
        settingSources: step.settingSources,
        abortController,
        onMessage: trackedMessage,
      }, {
        write: () => true,
      });
      if (result.isError) {
        const reason = result.subtype ?? "error";
        const detail = result.text.trim() || "Agent step returned an error result";
        const classified = classifyAgentRuntimeFailure({
          message: detail,
          subtype: result.subtype,
        });
        if (classified) {
          // SDK-returned isError means SDK already exhausted its internal retry
          // budget. A fresh step-level retry spawns a new session from scratch
          // (discarding the current session's in-memory progress) and the same
          // provider is still saturated, so it fails the same way. Fall through
          // to AgentBackoffManager instead, which applies a provider-kind delay
          // sized for the outage (5+ min) before dispatching the next run.
          throw new AgentStepRuntimeError(
            `Agent step "${step.id}" failed (${reason}): ${detail}`,
            classified.kind,
            false,
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
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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
      const sysError = error as NodeJS.ErrnoException;
      const errorWithStatus = error as { status?: number };
      const classified = classifyAgentRuntimeFailure({
        message: detail,
        status:
          typeof errorWithStatus.status === "number"
            ? errorWithStatus.status
            : undefined,
        code: typeof sysError.code === "string" ? sysError.code : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });
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

  const retry = step.retry ?? DEFAULT_AGENT_STEP_RETRY;
  const output = await withRetry(runAttempt, retry, {
    log: agentConfig.log,
    abortSignal: abortController.signal,
    // Only consume retry attempts for failures we can confidently classify
    // as transient (provider / JSON schema). Unclassified errors — max turns,
    // agent logic mistakes, malformed tool calls — fail hard on the first
    // attempt so we do not burn budget on deterministic failures.
    shouldRetry: (err) =>
      err instanceof JsonSchemaValidationError ||
      (err instanceof AgentStepRuntimeError && err.retryable),
  });

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
