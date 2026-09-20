/**
 * Neutral entry point for every `AgentHarness.run()` invocation.
 *
 * `runAgentHarness` dispatches harness-boundary hooks around the adapter's
 * native run, so preRun/postRun hooks registered via `registerHarnessHook`
 * fire consistently regardless of which adapter was selected. Callers that
 * need a harness should go through this function instead of invoking
 * `harness.run()` directly — only the adapter implementations themselves
 * (and the tests that cover them in isolation) touch `run()` without the
 * wrapper.
 */

import { randomUUID } from "node:crypto";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { withHarnessDelegationRuntime } from "#core/tools/delegation-runtime.js";
import { withNativeToolExecution } from "#core/tools/native-tool-execution.js";
import {
  registerSessionEnvironment,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";
import { createAgentHarnessCancellationBoundary } from "./cancellation.js";
import {
  type HarnessHookKind,
  hasHarnessHooks,
  listHarnessHooks,
} from "./hooks.js";
import { assertAdapterCanHostRequestedCapabilities } from "./run-option-routing.js";
import {
  type AgentHarnessSessionContext,
  declaredAgentHarnessSessionContext,
} from "./session-context.js";
import { prepareSessionContinuity, runWithSessionRecovery } from "./session-continuity.js";
import {
  type AgentTokenBudgetExhaustion,
  type AgentTokenBudgetSource,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "./token-budget.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "./types.js";
import {
  type AgentUsage,
  UNKNOWN_AGENT_USAGE,
  ZERO_AGENT_USAGE,
} from "./usage.js";

function createInvocationSessionContext(
  options: AgentHarnessRunOptions,
): AgentHarnessSessionContext | undefined {
  const declared = declaredAgentHarnessSessionContext(options);
  if (declared !== undefined) return declared;
  const workflow = options.workflowContext;
  const scopeRoot = options.scopeRoot ?? options.cwd;
  const scopeId = workflow?.scopeId ??
    (scopeRoot === undefined ? undefined : deriveDirectoryScopeId(scopeRoot));
  if (scopeId === undefined) return undefined;
  return {
    sessionId: `harness:${options.continuityKey ?? randomUUID()}`,
    scopeId,
  };
}

function assertAdapterHonorsRegisteredHooks(harness: AgentHarness): void {
  const supported = new Set(harness.supportedHookKinds);
  const kinds: HarnessHookKind[] = ["preRun", "postRun"];
  for (const kind of kinds) {
    if (hasHarnessHooks(kind) && !supported.has(kind)) {
      throw new Error(
        `Agent harness "${harness.name}" does not host the "${kind}" hook, ` +
          "but a module registered one. Remove the hook, migrate it to a " +
          "classic-loop hook, or run a harness that declares support.",
      );
    }
  }
}

function harnessBudgetSource(
  kind: AgentTokenBudgetSource["kind"],
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): AgentTokenBudgetSource {
  return {
    kind,
    harness: harness.name,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.workflowContext !== undefined
      ? {
          workflowName: options.workflowContext.workflowName,
          runId: options.workflowContext.runId,
          stepId: options.workflowContext.stepId,
          spanId: options.workflowContext.spanId,
        }
      : {}),
  };
}

export {
  harnessSupportsRunOption,
  routeKotaToolControlOptions,
  shouldRouteKotaToolControl,
} from "./run-option-routing.js";

function hasSameHarnessTurnDebitSince(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  initialDebitCount: number,
): boolean {
  return options.tokenBudget?.hasDebitSince(initialDebitCount, ({ source }) => {
    if (source.kind !== "harness-turn") return false;
    if (source.harness !== harness.name) return false;
    if (options.workflowContext === undefined) return true;
    return (
      source.workflowName === options.workflowContext.workflowName &&
      source.runId === options.workflowContext.runId &&
      source.stepId === options.workflowContext.stepId &&
      source.spanId === options.workflowContext.spanId
    );
  }) === true;
}

function tokenBudgetErrorResult(
  exhaustion: AgentTokenBudgetExhaustion,
  usage: AgentUsage = ZERO_AGENT_USAGE,
): AgentHarnessResult {
  return {
    text: exhaustion.message,
    streamedText: "",
    turns: 0,
    usage,
    isError: true,
    subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
  };
}

function recordInvocationTokenUsage(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  usage: AgentUsage,
  initialDebitCount: number,
): AgentTokenBudgetExhaustion | undefined {
  const tokenBudget = options.tokenBudget;
  if (tokenBudget === undefined) return undefined;
  if (hasSameHarnessTurnDebitSince(harness, options, initialDebitCount)) {
    return undefined;
  }

  const source = harnessBudgetSource("harness-result", harness, options);
  if (usage.tokens.state === "unknown") {
    tokenBudget.recordMissingUsage(
      source,
      `Agent harness "${harness.name}" did not report token usage for budget enforcement.`,
    );
    return undefined;
  }

  tokenBudget.recordNonEnforcing(
    source,
    `Agent harness "${harness.name}" reported usage only after the run completed; KOTA cannot stop between native/internal turns for this adapter.`,
  );
  tokenBudget.debitUsage(
    {
      inputTokens: usage.tokens.inputTokens,
      outputTokens: usage.tokens.outputTokens,
    },
    source,
  );
  if (usage.tokens.state === "partial") {
    tokenBudget.recordMissingUsage(
      source,
      `Agent harness "${harness.name}" reported only a measured lower bound for token usage.`,
    );
  }

  return tokenBudget.checkAfterDebit(source) ?? undefined;
}

/** Settled waits for ownership release, rejecting if native stop remains unresolved. */
export function runAgentHarness(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
  /** Import legacy context only under the owner lock, before any lineage exists. */
  seedConversation?: (prompt: string) => string,
): Promise<AgentHarnessResult> & { settled: Promise<void> } {
  let draining = Promise.resolve();
  const result = executeAgentHarness(harness, options, writer, (pending) => { draining = pending; }, seedConversation);
  const settled = result.then(() => draining, () => draining);
  // Most callers only observe the result; teardown owners also inspect settled.
  void settled.catch(() => {});
  return Object.assign(result, { settled });
}

async function executeAgentHarness(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  writer: AgentHarnessWriter | undefined,
  retainUntil: (pending: Promise<void>) => void,
  seedConversation?: (prompt: string) => string,
): Promise<AgentHarnessResult> {
  options.abortController?.signal.throwIfAborted();
  assertAdapterHonorsRegisteredHooks(harness);
  assertAdapterCanHostRequestedCapabilities(harness, options);
  const requireNativeQuarantine =
    harness.toolControl === "native" &&
    (options.abortController !== undefined || harness.nativeAbortQuarantine === "confirmed-stop");
  if (
    requireNativeQuarantine &&
    harness.nativeAbortQuarantine !== "confirmed-stop"
  ) {
    throw new Error(
      `Agent harness "${harness.name}" cannot launch a cancellable native execution ` +
        "without declaring nativeAbortQuarantine: \"confirmed-stop\".",
    );
  }

  // Reject identity mismatches before persistence or session-environment registration.
  declaredAgentHarnessSessionContext(options);
  const sessionIdObserver = options.onSessionId;
  const continuity = prepareSessionContinuity(harness, { ...options, onSessionId: undefined }, seedConversation);
  options = { ...continuity.options, onSessionId: sessionIdObserver };
  const usageObserver = options.onUsage;
  let reportedUsage: AgentUsage | undefined;
  let nativeResult: AgentHarnessResult | undefined;
  let invocationStarted = false;
  let usageFinalized = false;
  let executionPending: Promise<AgentHarnessResult> | undefined;
  const usageOptions: AgentHarnessRunOptions = usageObserver === undefined
    ? options
    : {
        ...options,
        onUsage: (usage) => {
          reportedUsage = usage;
        },
      };
  const sessionContext = createInvocationSessionContext(usageOptions);
  const sessionOptions = sessionContext === undefined || usageOptions.sessionContext !== undefined
    ? usageOptions
    : { ...usageOptions, sessionContext };
  const cancellation = createAgentHarnessCancellationBoundary(
    harness.name,
    sessionOptions,
    writer,
    requireNativeQuarantine,
    continuity.options.onSessionId,
  );
  const effectiveOptions = cancellation.options;
  const tokenBudget = options.tokenBudget;
  const tokenBudgetSource = tokenBudget
    ? harnessBudgetSource("harness-run", harness, options)
    : undefined;
  const initialDebitCount = tokenBudget?.debitCount() ?? 0;
  if (sessionContext !== undefined) registerSessionEnvironment(sessionContext);
  try {
    if (tokenBudget !== undefined && tokenBudgetSource !== undefined) {
      const exhaustion = tokenBudget.checkCanStartTurn(tokenBudgetSource);
      if (exhaustion) {
        usageObserver?.(ZERO_AGENT_USAGE);
        return tokenBudgetErrorResult(exhaustion);
      }
    }

    const execution = async (): Promise<AgentHarnessResult> => {
      for (const hook of listHarnessHooks("preRun")) {
        cancellation.assertActive();
        await hook.handler({ harness, options: effectiveOptions });
      }
      cancellation.assertActive();

      invocationStarted = true;
      const nativeRun = runWithSessionRecovery(
        continuity,
        effectiveOptions,
        (runOptions) => {
          if (requireNativeQuarantine) continuity.beginNativeExecution();
          const execution = withHarnessDelegationRuntime(harness.name, runOptions, () =>
            harness.toolControl === "native"
              ? withNativeToolExecution(runOptions, () => harness.run(runOptions, cancellation.writer))
              : harness.run(runOptions, cancellation.writer));
          try { cancellation.assertNativeQuarantineRegistered(); }
          catch (error) { void execution.catch(() => {}); throw error; }
          return execution;
        },
        async () => {
          await cancellation.retireSettledNativeAttempt();
          if (requireNativeQuarantine) continuity.confirmNativeStop();
        },
      );
      nativeResult = await nativeRun;
      if (nativeResult.sessionId !== undefined && effectiveOptions.persistSession === true) effectiveOptions.onSessionId?.(nativeResult.sessionId);
      cancellation.closeOutput();
      cancellation.assertActive();
      const usage = nativeResult.usage;
      const exhaustion = recordInvocationTokenUsage(
        harness,
        effectiveOptions,
        usage,
        initialDebitCount,
      );
      usageObserver?.(usage);
      usageFinalized = true;
      const result = exhaustion && !nativeResult.isError
        ? tokenBudgetErrorResult(exhaustion, usage)
        : { ...nativeResult, usage };

      for (const hook of listHarnessHooks("postRun")) {
        cancellation.assertActive();
        await hook.handler({ harness, options: effectiveOptions, result });
      }
      cancellation.assertActive();
      return result;
    };

    return await cancellation.race(() => {
      executionPending = execution();
      return executionPending;
    });
  } finally {
    cancellation.dispose();
    try {
      // Hosted cancellation can finish before transcript writes. Native adapters
      // instead establish safety through the confirmed-stop barrier.
      if (!requireNativeQuarantine && executionPending !== undefined) {
        retainUntil(executionPending.then(continuity.release, continuity.release));
      } else {
        const releaseNative = async () => {
          try {
            await cancellation.waitForNativeQuarantine();
            if (requireNativeQuarantine) continuity.confirmNativeStop();
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            // Persist exclusion before closing OS locks. Local process exit does
            // not establish that a remote provider stopped mutating its session.
            continuity.quarantine(failure);
            if (executionPending === undefined) continuity.release();
            else void executionPending.then(continuity.release, continuity.release);
            throw failure;
          }
          continuity.release();
        };
        const releasePending = releaseNative();
        retainUntil(releasePending);
        await releasePending;
      }
    } finally {
      try {
        if (invocationStarted && !usageFinalized) {
          const usage = reportedUsage ??
            (options.abortController?.signal.aborted ? undefined : nativeResult?.usage) ??
            UNKNOWN_AGENT_USAGE;
          recordInvocationTokenUsage(harness, sessionOptions, usage, initialDebitCount);
          usageObserver?.(usage);
        }
      } finally {
        if (sessionContext !== undefined) unregisterSessionEnvironment(sessionContext);
      }
    }
  }
}
