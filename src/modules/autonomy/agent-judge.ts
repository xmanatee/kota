import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWorkflowAgentGuards,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import { AgentBackoffAdmissionError } from "#core/workflow/agent-backoff.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolvePromptContextStartDir } from "#core/workflow/steps/step-executor-agent-prompt.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
} from "#core/workflow/steps/step-executor-retry.js";
import type { CriticVerdict } from "./critic-verdict.js";
import { decideJudgeResponse } from "./judge-response.js";
import { AUTONOMY_DISALLOWED_TOOLS, sleep } from "./shared.js";

export type AgentJudgeConfig = {
  label: string;
  systemPrompt: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Registered agent-harness name to dispatch this judge through. Required —
   * judges stay harness-neutral, so every caller must pass the harness it
   * resolved (normally the parent agent step's `step.harness`, which the
   * validator filled from `config.defaultAgentHarness`).
   */
  harness: string;
  agentWriteScope?: WorkflowAgentRunContractSpec["agentWriteScope"];
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;

const JSON_REMINDER =
  "\n\n## Format reminder\n" +
  "Your previous response did not contain valid JSON. Output exactly one JSON " +
  "object matching the schema in the system prompt — no narrative, no " +
  "checkmarks, no markdown, no code fences. The first character must be `{` " +
  "and the last must be `}`.";

export function resolveAgentJudgeRunContract(
  config: AgentJudgeConfig,
): WorkflowAgentRunContractSpec {
  let harness: ReturnType<typeof resolveAgentHarness> | undefined;
  try {
    harness = resolveAgentHarness(config.harness);
  } catch {
    // Metadata-only validation can run before harness modules are loaded.
  }
  return {
    harness: config.harness,
    model: config.model,
    effort: config.effort,
    autonomyMode: "autonomous",
    ownerQuestionAccess: "disabled",
    ...(config.agentWriteScope !== undefined ? { agentWriteScope: config.agentWriteScope } : {}),
    ...(harness?.toolControl === "kota"
      ? { disallowedTools: AUTONOMY_DISALLOWED_TOOLS }
      : {}),
  };
}

export function resolveAgentJudgePolicy(
  systemPrompt: string,
  scopeRoot: string,
): { systemPrompt: string; hash: string } {
  const startDir = resolvePromptContextStartDir(dirname(fileURLToPath(import.meta.url)), scopeRoot);
  const resolved = buildKotaSystemPrompt(undefined, systemPrompt, startDir, scopeRoot)!;
  return {
    systemPrompt: resolved,
    hash: createHash("sha256").update(resolved).digest("hex").slice(0, 12),
  };
}

export async function invokeAgentJudge(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
  runAgentHarness: WorkflowAgentHarnessRunner,
  scopeRoot: string,
  signal?: AbortSignal,
): Promise<CriticVerdict & { reviewerPromptHash: string }> {
  const policy = resolveAgentJudgePolicy(config.systemPrompt, scopeRoot);
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const harness = resolveAgentHarness(config.harness);
  const runContract = resolveAgentJudgeRunContract(config);
  let lastError: Error | undefined;
  let needsFormatReminder = false;
  let emptyOutputFailures = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryBaseDelayMs * attempt);
    }

    const promptForAttempt = needsFormatReminder ? userMessage + JSON_REMINDER : userMessage;

    let response: { text: string; isError: boolean; subtype?: string };
    try {
      const resolved = resolveWorkflowAgentRunContract({
        step: runContract,
        harness,
        model: runContract.model,
        prompt: promptForAttempt,
        canUseTool: createWorkflowAgentGuards(),
        askOwnerSource: `judge:${config.label}`,
      });
      response = await runAgentHarness(
        harness,
        {
          ...resolved.options,
          cwd,
          systemPrompt: policy.systemPrompt,
        },
        {
          signal,
          workspaceKey: cwd,
          writer: { write: () => true },
        },
      );
    } catch (thrown) {
      if (thrown instanceof AgentBackoffAdmissionError || thrown instanceof AgentStepRuntimeError) throw thrown;
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      lastError = new Error(
        `${config.label} threw (attempt ${attempt + 1}/${maxRetries}): ${message}`,
      );
      const code = thrown instanceof Error
        ? (thrown as NodeJS.ErrnoException).code
        : undefined;
      const classification = classifyAgentRuntimeFailure({
        message,
        code,
        errorName: thrown instanceof Error ? thrown.name : undefined,
      });
      if (!classification?.retryable) throw new AgentStepRuntimeError(lastError.message, classification?.kind ?? "runtime", false);
      needsFormatReminder = false;
      continue;
    }

    const decision = decideJudgeResponse({
      response, label: config.label, attempt: attempt + 1, maxAttempts: maxRetries,
      emptyOutputFailures,
    });
    if (decision.kind === "verdict") return { ...decision.verdict, reviewerPromptHash: policy.hash };
    if (decision.kind === "reject") throw decision.error;
    lastError = decision.error;
    needsFormatReminder = decision.formatReminder;
    emptyOutputFailures = decision.emptyOutputFailures;
  }
  throw new AgentStepRuntimeError(lastError!.message, "runtime", false);
}
