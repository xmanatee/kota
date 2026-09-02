import { runAgentHarness } from "#core/agent-harness/index.js";
import type { ProcessSpawnObserver } from "#core/execution/process-supervisor.js";
import {
  AgentBackoffAdmissionError,
  type AgentBackoffManager,
} from "../agent-backoff.js";
import type { WorkflowAgentHarnessRunner } from "../run-types.js";
import {
  classifyAgentRuntimeFailure,
  classifyThrownAgentError,
} from "./step-executor-retry.js";

function incidentReason(input: {
  harnessName: string;
  message: string;
  subtype?: string;
}): string {
  const detail = input.message.trim() || input.subtype ||
    "classified provider failure";
  return `Agent harness "${input.harnessName}" failed${
    input.subtype === undefined ? "" : ` (${input.subtype})`
  }: ${detail}`;
}

export function createWorkflowAgentHarnessRunner(
  onProcessSpawn?: ProcessSpawnObserver,
  agentBackoff?: AgentBackoffManager,
  scopeId = "unscoped",
): WorkflowAgentHarnessRunner {
  return async (harness, options, execution = {}) => {
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(execution.signal?.reason);
    if (execution.signal?.aborted) forwardAbort();
    else execution.signal?.addEventListener("abort", forwardAbort, { once: true });
    let releaseAdmission: (() => void) | undefined;

    try {
      releaseAdmission = agentBackoff?.registerAttempt(abortController, scopeId);
      const result = await runAgentHarness(
        harness,
        {
          ...options,
          ...(onProcessSpawn === undefined ? {} : { onProcessSpawn }),
          abortController,
        },
        execution.writer,
      );
      const classification = classifyAgentRuntimeFailure({
        message: result.text,
        subtype: result.subtype,
      });
      if (!result.isError || classification === null || agentBackoff === undefined) {
        return result;
      }
      const signal = {
        kind: classification.kind,
        reason: incidentReason({
          harnessName: harness.name,
          message: result.text,
          ...(result.subtype === undefined ? {} : { subtype: result.subtype }),
        }),
        ...(classification.retryAt === undefined
          ? {}
          : { retryAt: classification.retryAt }),
      };
      const backoff = agentBackoff.apply(signal);
      throw new AgentBackoffAdmissionError(backoff, signal);
    } catch (error) {
      if (error instanceof AgentBackoffAdmissionError) throw error;
      if (abortController.signal.reason instanceof AgentBackoffAdmissionError) {
        throw abortController.signal.reason;
      }
      if (agentBackoff === undefined) throw error;
      const classification = classifyThrownAgentError(error);
      if (classification === null) throw error;
      const signal = {
        kind: classification.kind,
        reason: incidentReason({
          harnessName: harness.name,
          message: error instanceof Error ? error.message : String(error),
        }),
        ...(classification.retryAt === undefined
          ? {}
          : { retryAt: classification.retryAt }),
      };
      const backoff = agentBackoff.apply(signal);
      throw new AgentBackoffAdmissionError(backoff, signal);
    } finally {
      releaseAdmission?.();
      execution.signal?.removeEventListener("abort", forwardAbort);
    }
  };
}
