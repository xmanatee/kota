import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  isEmptyAgentOutputSubtype,
} from "#core/workflow/steps/step-executor-retry.js";
import { type CriticVerdict, parseVerdict } from "./critic-verdict.js";

export type JudgeResponseDecision =
  | { kind: "verdict"; verdict: CriticVerdict }
  | { kind: "reject"; error: Error }
  | { kind: "retry"; error: Error; formatReminder: boolean; emptyOutputFailures: number };

/** Own verdict recovery and output retries; provider classification remains runtime-owned. */
export function decideJudgeResponse(input: {
  response: { text: string; isError: boolean; subtype?: string };
  label: string;
  attempt: number;
  maxAttempts: number;
  emptyOutputFailures: number;
}): JudgeResponseDecision {
  const { response, label, attempt, maxAttempts } = input;
  let parseError: unknown;
  try {
    // A budget-exhausted harness can still have produced a complete verdict.
    return { kind: "verdict", verdict: parseVerdict(response.text) };
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
  if (emptyOutputFailures >= maxAttempts) {
    return {
      kind: "reject",
      error: new AgentStepRuntimeError(
        `${label} produced ${emptyOutputFailures} successful terminal results without a usable verdict (${response.subtype})`,
        "output_contract", false,
      ),
    };
  }
  const error = new Error(
    `${label} returned unparseable response (attempt ${attempt}/${maxAttempts}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
  );
  return attempt < maxAttempts
    ? { kind: "retry", error, formatReminder: true, emptyOutputFailures }
    : { kind: "reject", error };
}
