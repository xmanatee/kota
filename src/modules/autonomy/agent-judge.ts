import {
  createWorkflowAgentGuards,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { parseVerdict } from "./critic-verdict.js";
import { AUTONOMY_DISALLOWED_TOOLS, sleep } from "./shared.js";

export type AgentJudgeConfig = {
  label: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Registered agent-harness name to dispatch this judge through. Required —
   * judges stay harness-neutral, so every caller must pass the harness it
   * resolved (normally the parent agent step's `step.harness`, which the
   * validator filled from `config.defaultAgentHarness`).
   */
  harness: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Optional typed response decoder for non-critic judge protocols. */
  validateResponse?: (text: string) => void;
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
    maxTurns: config.maxTurns,
    autonomyMode: "autonomous",
    ownerQuestionAccess: "disabled",
    ...(harness?.toolControl === "kota"
      ? { disallowedTools: AUTONOMY_DISALLOWED_TOOLS }
      : {}),
  };
}

export async function invokeAgentJudge(
  userMessage: string,
  cwd: string,
  config: AgentJudgeConfig,
  runAgentHarness: WorkflowAgentHarnessRunner,
  signal?: AbortSignal,
): Promise<{ text: string; isError: boolean; subtype?: string }> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const harness = resolveAgentHarness(config.harness);
  const runContract = resolveAgentJudgeRunContract(config);
  let lastError: Error | undefined;
  let needsFormatReminder = false;

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

    if (!response.isError) {
      try {
        validateJudgeResponse(response.text, config);
        return response;
      } catch (error) {
        lastError = new Error(
          `${config.label} returned unparseable response (attempt ${attempt + 1}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`,
        );
        needsFormatReminder = true;
        continue;
      }
    }

    // isError=true path. Prefer to recover a parseable verdict from any
    // emitted text before deciding whether to retry — an agent that hit
    // max_turns may still have produced a valid JSON verdict before bailing.
    if (response.text.trim()) {
      if (isParseableJudgeResponse(response.text, config)) {
        return response;
      }
    }

    const failureDetail = response.text.trim() || response.subtype || "unknown error";
    lastError = new Error(
      `${config.label} failed (attempt ${attempt + 1}/${maxRetries}): ${failureDetail}`,
    );

    // Runaway subtypes (error_max_turns, error_max_tokens) are deterministic
    // budget exhaustion, not transient provider problems. Retrying burns
    // budget without changing the turn/token ceiling. Fail fast on anything
    // the classifier does not explicitly mark retryable — same policy the
    // workflow step-executor applies to agent steps.
    const classification = classifyAgentRuntimeFailure({
      message: response.text,
      subtype: response.subtype,
    });
    if (!classification?.retryable) throw lastError;
    needsFormatReminder = false;
  }
  throw lastError!;
}

function validateJudgeResponse(text: string, config: AgentJudgeConfig): void {
  if (config.validateResponse !== undefined) {
    config.validateResponse(text);
    return;
  }
  parseVerdict(text);
}

function isParseableJudgeResponse(
  text: string,
  config: AgentJudgeConfig,
): boolean {
  let parseable = true;
  try {
    validateJudgeResponse(text, config);
  } catch {
    parseable = false;
  }
  return parseable;
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
