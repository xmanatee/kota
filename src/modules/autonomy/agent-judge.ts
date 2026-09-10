import {
  createWorkflowAgentGuards,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { AgentBackoffAdmissionError } from "#core/workflow/agent-backoff.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  isEmptyAgentOutputSubtype,
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
    agentWriteScope: "deny-all",
    ownerQuestionAccess: "disabled",
    ...(config.agentWriteScope !== undefined ? { agentWriteScope: config.agentWriteScope } : {}),
    ...(harness?.toolControl === "kota"
      ? { disallowedTools: AUTONOMY_DISALLOWED_TOOLS }
      : {}),
  };
}

type JudgeResponse = { text: string; isError: boolean; subtype?: string };
type JudgeDecision<T> =
  | { kind: "verdict"; verdict: T }
  | { kind: "reject"; error: Error }
  | { kind: "retry"; error: Error; formatReminder: boolean; emptyOutputFailures: number };
type JudgeResponseInput = Parameters<typeof decideJudgeResponse>[0];

export function invokeAgentJudge(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
  runAgentHarness: WorkflowAgentHarnessRunner,
  signal?: AbortSignal,
): Promise<CriticVerdict> {
  return invokeJudge(userMessage, cwd, config, runAgentHarness, decideJudgeResponse, signal);
}

export function invokeStructuredAgentJudge<T>(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
  runAgentHarness: WorkflowAgentHarnessRunner,
  parse: (text: string) => T,
  signal?: AbortSignal,
): Promise<JudgeResponse> {
  return invokeJudge(userMessage, cwd, config, runAgentHarness, (input) => {
    const { response, label, attempt, maxAttempts } = input;
    let parseError: unknown;
    try {
      parse(response.text);
      return { kind: "verdict", verdict: response };
    } catch (error) {
      parseError = error;
    }
    if (response.isError) {
      const error = new Error(
        `${label} failed (attempt ${attempt}/${maxAttempts}): ${response.text.trim() || response.subtype || "unknown error"}`,
      );
      const classification = classifyAgentRuntimeFailure({ message: response.text, subtype: response.subtype });
      return classification?.retryable && attempt < maxAttempts
        ? { kind: "retry", error, formatReminder: false, emptyOutputFailures: 0 }
        : { kind: "reject", error };
    }
    const emptyOutputFailures = isEmptyAgentOutputSubtype(response.subtype)
      ? input.emptyOutputFailures + 1 : 0;
    const error = emptyOutputFailures >= maxAttempts
      ? new AgentStepRuntimeError(
          `${label} produced ${emptyOutputFailures} successful terminal results without usable structured output (${response.subtype})`,
          "output_contract", false,
        )
      : new Error(
          `${label} returned unparseable response (attempt ${attempt}/${maxAttempts}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
    return attempt < maxAttempts
      ? { kind: "retry", error, formatReminder: true, emptyOutputFailures }
      : { kind: "reject", error };
  }, signal);
}

async function invokeJudge<T>(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
  runAgentHarness: WorkflowAgentHarnessRunner,
  decideResponse: (input: JudgeResponseInput) => JudgeDecision<T>,
  signal?: AbortSignal,
): Promise<T> {
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
          systemPrompt: config.systemPrompt,
        },
        {
          signal,
          workspaceKey: cwd,
          writer: { write: () => true },
        },
      );
    } catch (thrown) {
      if (thrown instanceof AgentBackoffAdmissionError) throw thrown;
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
      if (!classification?.retryable) throw lastError;
      needsFormatReminder = false;
      continue;
    }

    const decision = decideResponse({
      response, label: config.label, attempt: attempt + 1, maxAttempts: maxRetries,
      emptyOutputFailures,
    });
    if (decision.kind === "verdict") return decision.verdict;
    if (decision.kind === "reject") throw decision.error;
    lastError = decision.error;
    needsFormatReminder = decision.formatReminder;
    emptyOutputFailures = decision.emptyOutputFailures;
  }
  throw lastError!;
}

/**
 * True when a thrown `invokeAgentJudge` error represents runaway budget
 * exhaustion (max turns / max tokens) rather than a defect in the diff
 * being reviewed. The repair-loop caller uses this to degrade the check
 * to a warning: a repair agent cannot shrink the judge's turn budget by
 * editing code, so iterating would be wasted work. Keyed on stable SDK
 * signals (result subtype and canonical CLI error phrase).
 */
export function isJudgeRunawayError(err: Error): boolean {
  const message = err.message;
  if (/error_max_turns|error_max_tokens/i.test(message)) return true;
  if (/Reached maximum number of (?:turns|tokens)/i.test(message)) return true;
  return false;
}

export function judgeUnavailableResult(label: string, err: Error): string {
  const detail = err.message;
  return (
    `WARN: ${label} unavailable (${detail}). ` +
    `Skipping gate for this run; the diff proceeds on mechanical checks only. ` +
    `See evaluator-calibration.json (verdict=absent).`
  );
}
