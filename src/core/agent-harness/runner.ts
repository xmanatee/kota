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
    sessionId: `harness:${randomUUID()}`,
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
): AgentHarnessResult {
  return {
    text: exhaustion.message,
    streamedText: "",
    turns: 0,
    isError: true,
    subtype: TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
  };
}

function applyResultOnlyTokenBudgetDebit(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  result: AgentHarnessResult,
  initialDebitCount: number,
): AgentHarnessResult {
  const tokenBudget = options.tokenBudget;
  if (tokenBudget === undefined) return result;
  if (hasSameHarnessTurnDebitSince(harness, options, initialDebitCount)) {
    return result;
  }

  const source = harnessBudgetSource("harness-result", harness, options);
  if (result.inputTokens === undefined && result.outputTokens === undefined) {
    tokenBudget.recordMissingUsage(
      source,
      `Agent harness "${harness.name}" did not report token usage for budget enforcement.`,
    );
    return result;
  }

  tokenBudget.recordNonEnforcing(
    source,
    `Agent harness "${harness.name}" reported usage only after the run completed; KOTA cannot stop between native/internal turns for this adapter.`,
  );
  tokenBudget.debitUsage(
    {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    source,
  );

  const exhaustion = tokenBudget.checkAfterDebit(source);
  if (exhaustion && !result.isError) return tokenBudgetErrorResult(exhaustion);
  return result;
}

export async function runAgentHarness(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  assertAdapterHonorsRegisteredHooks(harness);
  assertAdapterCanHostRequestedCapabilities(harness, options);
  const requireNativeQuarantine =
    harness.toolControl === "native" && options.abortController !== undefined;
  if (
    requireNativeQuarantine &&
    harness.nativeAbortQuarantine !== "confirmed-stop"
  ) {
    throw new Error(
      `Agent harness "${harness.name}" cannot launch a cancellable native execution ` +
        "without declaring nativeAbortQuarantine: \"confirmed-stop\".",
    );
  }

  const sessionContext = createInvocationSessionContext(options);
  const sessionOptions = sessionContext === undefined || options.sessionContext !== undefined
    ? options
    : { ...options, sessionContext };
  const cancellation = createAgentHarnessCancellationBoundary(
    harness.name,
    sessionOptions,
    writer,
    requireNativeQuarantine,
  );
  const effectiveOptions = cancellation.options;
  if (sessionContext !== undefined) registerSessionEnvironment(sessionContext);
  try {
    const tokenBudget = options.tokenBudget;
    const tokenBudgetSource = tokenBudget
      ? harnessBudgetSource("harness-run", harness, options)
      : undefined;
    const initialDebitCount = tokenBudget?.debitCount() ?? 0;
    if (tokenBudget !== undefined && tokenBudgetSource !== undefined) {
      const exhaustion = tokenBudget.checkCanStartTurn(tokenBudgetSource);
      if (exhaustion) return tokenBudgetErrorResult(exhaustion);
    }

    const execution = async (): Promise<AgentHarnessResult> => {
      for (const hook of listHarnessHooks("preRun")) {
        cancellation.assertActive();
        await hook.handler({ harness, options: effectiveOptions });
      }
      cancellation.assertActive();

      const nativeRun = harness.run(effectiveOptions, cancellation.writer);
      try {
        cancellation.assertNativeQuarantineRegistered();
      } catch (error) {
        void nativeRun.catch(() => {});
        throw error;
      }
      const nativeResult = await nativeRun;
      cancellation.closeOutput();
      cancellation.assertActive();
      const result = applyResultOnlyTokenBudgetDebit(
        harness,
        effectiveOptions,
        nativeResult,
        initialDebitCount,
      );

      for (const hook of listHarnessHooks("postRun")) {
        cancellation.assertActive();
        await hook.handler({ harness, options: effectiveOptions, result });
      }
      cancellation.assertActive();
      return result;
    };

    return await cancellation.race(execution);
  } finally {
    cancellation.dispose();
    if (sessionContext !== undefined) unregisterSessionEnvironment(sessionContext);
  }
}
