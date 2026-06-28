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

import {
  type HarnessHookKind,
  hasHarnessHooks,
  listHarnessHooks,
} from "./hooks.js";
import type {
  AgentHarnessUnsupportedOption,
  AgentHarnessUnsupportedRunOption,
} from "./readiness.js";
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

function assertAdapterCanHostRequestedCapabilities(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): void {
  const unsupported = requestedUnsupportedOptions(harness, options);
  if (unsupported.length > 0) {
    const labels = unsupported.map((entry) => entry.option).join(", ");
    const reasons = unsupported.map((entry) => `${entry.option}: ${entry.reason}`).join("; ");
    throw new Error(
      `Agent harness "${harness.name}" cannot honor requested run option(s): ${labels}. ` +
        `${reasons}`,
    );
  }
  if (options.askOwner && harness.askOwnerToolName === null) {
    throw new Error(
      `Agent harness "${harness.name}" cannot host the owner-questions surface (askOwnerToolName is null). ` +
        "Drop askOwner or run a harness that declares support — never run owner-questions silently disabled.",
    );
  }
}

function requestedUnsupportedOptions(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): AgentHarnessUnsupportedOption[] {
  return (harness.unsupportedRunOptions ?? []).filter((entry) =>
    entry.runOption !== undefined && isRunOptionRequested(entry.runOption, options)
  );
}

function isRunOptionRequested(
  option: AgentHarnessUnsupportedRunOption,
  options: AgentHarnessRunOptions,
): boolean {
  if (option === "mcpServers") {
    return options.mcpServers !== undefined && Object.keys(options.mcpServers).length > 0;
  }
  if (option === "allowedTools") {
    return options.allowedTools !== undefined && options.allowedTools.length > 0;
  }
  if (option === "disallowedTools") {
    return options.disallowedTools !== undefined && options.disallowedTools.length > 0;
  }
  if (option === "canUseTool") return options.canUseTool !== undefined;
  if (option === "askOwner") return options.askOwner !== undefined;
  if (option === "autonomyMode.supervised") return options.autonomyMode === "supervised";
  if (option === "persistSession") return options.persistSession === true;
  if (option === "resumeSessionId") return options.resumeSessionId !== undefined;
  if (option === "env") {
    return options.env !== undefined && Object.keys(options.env).length > 0;
  }
  if (option === "harnessOverrides") return options.harnessOverrides !== undefined;
  if (option === "enableFileCheckpointing") return options.enableFileCheckpointing === true;
  if (option === "thinking") {
    return options.thinkingEnabled === true || options.thinkingBudget !== undefined;
  }
  return options.onMessage !== undefined;
}

export function shouldRouteKotaToolControl(harness: AgentHarness): boolean {
  return harness.toolControl === "kota";
}

export function routeKotaToolControlOptions(
  harness: AgentHarness,
  options: {
    allowedTools?: string[];
    disallowedTools?: string[];
    canUseTool?: AgentHarnessRunOptions["canUseTool"];
  },
): {
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: AgentHarnessRunOptions["canUseTool"];
} {
  if (!shouldRouteKotaToolControl(harness)) return {};
  return options;
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

  const tokenBudget = options.tokenBudget;
  const tokenBudgetSource = tokenBudget
    ? harnessBudgetSource("harness-run", harness, options)
    : undefined;
  const initialDebitCount = tokenBudget?.debitCount() ?? 0;
  if (tokenBudget !== undefined && tokenBudgetSource !== undefined) {
    const exhaustion = tokenBudget.checkCanStartTurn(tokenBudgetSource);
    if (exhaustion) return tokenBudgetErrorResult(exhaustion);
  }

  for (const hook of listHarnessHooks("preRun")) {
    await hook.handler({ harness, options });
  }

  const result = applyResultOnlyTokenBudgetDebit(
    harness,
    options,
    await harness.run(options, writer),
    initialDebitCount,
  );

  for (const hook of listHarnessHooks("postRun")) {
    await hook.handler({ harness, options, result });
  }

  return result;
}
