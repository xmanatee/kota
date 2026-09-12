import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { composeCanUseTools } from "#core/agent-harness/guards.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import { createWriterAgentEffectGuard } from "#core/workflow/transaction-effect-policy.js";
import { getModuleToolEffectMetadata } from "./tool-effect-registry.js";
import { executeToolCalls } from "./tool-runner.js";
import type { ToolResultEntry } from "./tool-runner-types.js";

const invocation = new AsyncLocalStorage<AgentHarnessRunOptions>();

/** Authority stays in the hosting invocation; no transport field supplies it. */
export function withNativeToolExecution<T>(
  options: AgentHarnessRunOptions,
  run: () => T,
): T {
  return invocation.run(options, run);
}

export function nativeToolExecutor(
  artifactRoot: string,
  origin?: { runId: string; workspaceDir: string; scopeRoot: string },
):
  | ((
      name: string,
      input: Record<string, unknown>,
      id: string,
      signal: AbortSignal,
    ) => Promise<ToolResultEntry>)
  | undefined {
  const options = invocation.getStore();
  if (
    !options?.workflowContext ||
    !options.scopeRoot ||
    !options.agentOutputDir
  )
    return undefined;
  if (
    origin &&
    (options.workflowContext.runId !== origin.runId ||
      realpathSync(options.cwd ?? process.cwd()) !== origin.workspaceDir ||
      realpathSync(options.scopeRoot) !== origin.scopeRoot)
  ) {
    throw new Error("Native tool invocation does not match its hosting run");
  }
  return async (name, input, id, signal) => {
    if (getModuleToolEffectMetadata(name)?.nativeInvocation !== true) {
      return {
        tool_use_id: id,
        content: "Tool is unavailable through native invocation.",
        is_error: true,
      };
    }
    const signals = [
      signal,
      ...(options.abortController ? [options.abortController.signal] : []),
    ];
    const [result] = await executeToolCalls(
      [{ type: "tool_use", name, input, id }],
      {
        onProcessSpawn: options.onProcessSpawn,
        onExecutionFailure: options.onExecutionFailure,
        resultLimit: 100_000,
        verbose: false,
        autonomyMode: options.autonomyMode ?? "supervised",
        scopeRoot: options.scopeRoot,
        cwd: options.cwd,
        scopeId: options.workflowContext!.scopeId,
        workflowContext: options.workflowContext,
        agentWriteScope: options.agentWriteScope,
        agentOutputDir: artifactRoot,
        scopePolicy: options.scopePolicy,
        getScopePolicySnapshot: options.getScopePolicySnapshot,
        guardrailsConfig: options.guardrailsConfig,
        authorityConfigPath: options.authorityConfigPath,
        sessionId: options.sessionContext?.sessionId,
        signal: AbortSignal.any(signals),
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        canUseTool: composeCanUseTools(
          ...(options.canUseTool ? [options.canUseTool] : []),
          createWriterAgentEffectGuard(),
        ),
      },
    );
    if (!result) throw new Error("Native tool invocation returned no result");
    return result;
  };
}
