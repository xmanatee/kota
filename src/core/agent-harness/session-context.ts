import type { ToolRunnerContext } from "#core/tools/index.js";
import type { AgentHarnessRunOptions } from "./types.js";

/**
 * Runtime identity for KOTA-owned tools invoked by one harness session.
 * This is deliberately separate from workflow trace/span metadata: concurrent
 * executions of the same workflow step must never share session-local state.
 */
export type AgentHarnessSessionContext = {
  sessionId: string;
  scopeId: string;
};

export type AgentHarnessToolRunnerContext = Pick<
  ToolRunnerContext,
  "sessionId" | "scopeId" | "workflow"
>;

function assertSessionScopeMatchesWorkflow(
  session: AgentHarnessSessionContext,
  options: AgentHarnessRunOptions,
): void {
  const workflow = options.workflowContext;
  if (workflow === undefined) return;
  if (session.scopeId !== workflow.scopeId) {
    throw new Error(
      "Agent harness session scope must match its workflow scope",
    );
  }
}

export function declaredAgentHarnessSessionContext(
  options: AgentHarnessRunOptions,
): AgentHarnessSessionContext | undefined {
  const session = options.sessionContext;
  if (session !== undefined) assertSessionScopeMatchesWorkflow(session, options);
  return session;
}

/** Build the exact KOTA tool-runner identity routed by in-process adapters. */
export function agentHarnessToolRunnerContext(
  options: AgentHarnessRunOptions,
): AgentHarnessToolRunnerContext {
  const workflow = options.workflowContext;
  const session = declaredAgentHarnessSessionContext(options) ??
    (workflow === undefined
      ? undefined
      : {
          sessionId: workflow.spanId,
          scopeId: workflow.scopeId,
        });
  return {
    ...(session !== undefined ? session : {}),
    ...(workflow !== undefined ? { workflow } : {}),
  };
}
